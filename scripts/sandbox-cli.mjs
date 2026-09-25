import { readFile } from 'node:fs/promises';

export const sandboxHelp =
  '\nSandbox workbench (sandbox plugin):\n  sandboxes\n  sandbox create <name> [config.json]\n  sandbox <start|stop|destroy|logs> <name>\n  sandbox run <name> -- <command> [args...]';
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

export async function sandboxCommand(action, verb, args, api) {
  if (action === 'sandboxes') {
    if (verb || args.length) throw new Error('Usage: sandboxes');
    return { handled: true, value: await api('/sandboxes') };
  }
  if (action !== 'sandbox') return { handled: false };
  const [name, ...rest] = args;
  if (!name || !['create', 'start', 'stop', 'destroy', 'logs', 'run'].includes(verb))
    throw new Error(sandboxHelp);
  if (verb === 'create') {
    if (rest.length > 1) throw new Error('Usage: sandbox create <name> [config.json]');
    const config = rest[0] ? JSON.parse(await readFile(rest[0], 'utf8')) : {};
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('Invalid sandbox config');
    return { handled: true, value: await api('/sandboxes', 'POST', { ...config, name }) };
  }
  if (verb === 'run' ? rest[0] !== '--' || rest.length < 2 : rest.length) throw new Error(sandboxHelp);
  const overview = await api('/sandboxes');
  const vm = overview.sandboxes.find((item) => item.id === name || item.name === name);
  if (verb === 'logs') {
    const runs = overview.runs.filter(
      (job) => job.vmId === (vm?.id || name) || (!vm && job.title === name + ' · 沙箱命令'),
    );
    return { handled: true, value: runs };
  }
  if (!vm) throw new Error('Sandbox not found: ' + name);
  const path = '/vms/' + encodeURIComponent(vm.id) + '/sandbox';
  const value =
    verb === 'run'
      ? await api(path + '/run', 'POST', { command: rest.slice(1).map(quote).join(' ') })
      : verb === 'destroy'
        ? await api(path, 'DELETE')
        : await api(path, 'POST', { action: verb });
  return { handled: true, value };
}
