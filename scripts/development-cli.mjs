import { readFile, open, lstat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const developmentHelp = `
Development tools:
  git <name> [status|diff|stage|unstage|commit|switch|branch|init] [arguments...]
  git <name> diff <path> [--staged]
  project-files <name> [query] [--content]
  commands <name> [list|save|remove|run] [preset.json|id] [values.json]
  tools <name> [install] [git|node|python|rust|go|java|php...]
  network <name> [show|preview|apply|restore|test] [config.json|preview.json]
  secrets <name> [list|put|remove] [secret-name]
  health <name>
  containers <name> [list|install|logs|start|stop|restart|remove|pull|remove-image|compose-up|compose-down|compose-restart] [id|image|file]
  backup-download <name> <backup-id> <output-file>
  migration [show|preview|start|cancel-activation] [new-directory|preview.json]

Passwords: set SAKURA_BACKUP_PASSWORD for backup/import; never pass it as an argument.
Secret values: set SAKURA_SECRET_VALUE for secrets put; values are never printed.
Network apply and migration start accept the JSON returned by preview.
Long operations return a job; use tasks to inspect progress and logs.`;
const jsonFile = async (path) => {
  if (!path) throw new Error('Specify a JSON file');
  return JSON.parse(await readFile(path, 'utf8'));
};
export async function downloadBackup(api, base, vm, backupId, destination) {
  if (!backupId || !destination) throw new Error('Usage: backup-download <name> <backup-id> <output-file>');
  const file = await open(destination, 'wx', 0o600),
    identity = await file.stat();
  const abort = new AbortController(),
    cancel = () => abort.abort();
  let complete = false;
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const { url } = await api(`/vms/${vm.id}/backup-download`, 'POST', { backupId });
    if (!/^\/api\/downloads\/[a-f0-9]{64}$/.test(url)) throw new Error('Invalid download ticket');
    const response = await fetch(base + url, { signal: abort.signal });
    if (!response.ok) throw new Error((await response.json()).error || 'Download failed');
    await pipeline(Readable.fromWeb(response.body), file.createWriteStream(), { signal: abort.signal });
    complete = true;
    return { file: destination };
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await file.close();
    if (!complete) {
      const current = await lstat(destination).catch(() => null);
      if (current?.dev === identity.dev && current.ino === identity.ino) await unlink(destination);
    }
  }
}
export async function developmentCommand(action, name, args, api, base) {
  if (action === 'migration') {
    if (!name || name === 'show') return { handled: true, value: await api('/migration') };
    if (name === 'preview')
      return {
        handled: true,
        value: await api('/migration', 'POST', { action: 'preview', target: args[0] }),
      };
    if (name === 'cancel-activation')
      return { handled: true, value: await api('/migration', 'POST', { action: name }) };
    if (name !== 'start') throw new Error('Unknown migration action');
    const preview = await jsonFile(args[0]);
    return {
      handled: true,
      value: await api('/migration', 'POST', {
        action: 'start',
        target: preview.target,
        token: preview.token,
      }),
    };
  }
  if (
    ![
      'git',
      'project-files',
      'commands',
      'tools',
      'network',
      'secrets',
      'health',
      'containers',
      'backup-download',
    ].includes(action)
  )
    return { handled: false };
  const vm = (await api('/vms')).find((value) => value.name === name || value.id === name);
  if (!vm) throw new Error(`Distribution not found: ${name}`);
  const path = `/vms/${vm.id}/${action}`,
    [kind, target, extra] = args;
  let value;
  if (action === 'project-files')
    value = await api(
      `${path}?q=${encodeURIComponent(args.filter((v) => v !== '--content').join(' '))}&content=${args.includes('--content') ? 1 : 0}`,
    );
  else if (action === 'health') value = await api(path);
  else if (action === 'backup-download') value = await downloadBackup(api, base, vm, kind, target);
  else if (action === 'git') {
    if (!kind || kind === 'status') value = await api(path);
    else if (kind === 'diff') {
      if (!target) throw new Error('Specify a repository-relative path');
      value = await api(`${path}?path=${encodeURIComponent(target)}&staged=${extra === '--staged' ? 1 : 0}`);
    } else if (['stage', 'unstage'].includes(kind))
      value = await api(path, 'POST', { action: kind, paths: args.slice(1) });
    else if (kind === 'commit')
      value = await api(path, 'POST', { action: kind, message: args.slice(1).join(' ') });
    else if (['switch', 'branch'].includes(kind))
      value = await api(path, 'POST', { action: kind, branch: target });
    else if (kind === 'init') value = await api(path, 'POST', { action: kind });
    else throw new Error('Unknown Git action');
  } else if (action === 'commands') {
    if (!kind || kind === 'list') value = await api(path);
    else if (kind === 'save') value = await api(path, 'PUT', await jsonFile(target));
    else if (kind === 'remove') value = await api(path, 'DELETE', { id: target });
    else if (kind === 'run')
      value = await api(path, 'POST', { id: target, values: extra ? await jsonFile(extra) : {} });
    else throw new Error('Unknown command-preset action');
  } else if (action === 'tools') {
    if (!kind || kind === 'list') value = await api(path);
    else if (kind === 'install') value = await api(path, 'POST', { tools: args.slice(1) });
    else throw new Error('Unknown tools action');
  } else if (action === 'network') {
    if (!kind || kind === 'show') value = await api(path);
    else if (kind === 'restore') value = await api(path, 'POST', { action: kind });
    else if (kind === 'apply') {
      const preview = await jsonFile(target);
      value = await api(path, 'POST', { action: kind, config: preview.config, token: preview.token });
    } else if (['preview', 'test'].includes(kind))
      value = await api(path, 'POST', { action: kind, config: await jsonFile(target) });
    else throw new Error('Unknown network action');
  } else if (action === 'secrets') {
    if (!kind || kind === 'list') value = await api(path);
    else if (kind === 'remove') value = await api(path, 'DELETE', { name: target });
    else if (kind === 'put') {
      if (!process.env.SAKURA_SECRET_VALUE)
        throw new Error('Set SAKURA_SECRET_VALUE before saving a private value');
      value = await api(path, 'PUT', { name: target, value: process.env.SAKURA_SECRET_VALUE });
    } else throw new Error('Unknown secrets action');
  } else {
    if (!kind || kind === 'list') value = await api(path);
    else if (kind === 'logs') value = await api(`${path}?logs=${encodeURIComponent(target || '')}`);
    else if (kind === 'install') value = await api(path, 'POST', { action: kind });
    else if (['start', 'stop', 'restart', 'remove'].includes(kind))
      value = await api(path, 'POST', { action: kind, id: target });
    else if (['pull', 'remove-image'].includes(kind))
      value = await api(path, 'POST', { action: kind, image: target });
    else if (['compose-up', 'compose-down', 'compose-restart'].includes(kind))
      value = await api(path, 'POST', { action: kind, file: target });
    else throw new Error('Unknown container action');
  }
  return { handled: true, value };
}
