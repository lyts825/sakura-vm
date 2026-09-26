#!/usr/bin/env node
import { WebSocket } from 'ws';
import { createReadStream } from 'node:fs';
import { readFile, open, lstat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const base = `http://127.0.0.1:${process.env.SAKURA_PORT || 7337}`;
const [action = 'help', name, ...args] = process.argv.slice(2);
async function main() {
  if (action === 'help') {
    if (name !== 'all') {
      console.log(
        'Sakura — minimal Linux workspace\n\n  list\n  create <name>\n  start <name>\n  stop <name>\n  shell <name>\n  exec <name> -- <command> [args...]\n  plugins\n  plugin <enable|disable> <id>\n  pack <enable|disable> <id>\n  help all\n\nOptional commands require their plugin. Plugin changes take effect after restarting the service.',
      );
      return;
    }
    const { developmentHelp } = await import('./development-cli.mjs');
    const { sandboxHelp } = await import('./sandbox-cli.mjs');
    console.log(
      '\nNew workspace features\n  projects <name> [list|create|select|rename]\n  history <name> [path|restore|purge]\n  pipeline <name> [list|save|run|remove]\n  runtimes <name> [inspect|select|install]\n  code-check <name> [path]\n  compact <name>\n  events',
    );
    console.log(
      'Sakura — local Linux workspaces\n\n  list\n  images\n  image <alpine|debian|ubuntu>\n  create <name> [alpine|debian|ubuntu] [none|node|python|rust]\n  start <name>\n  stop <name>\n  suspend <name>\n  resume <name>\n  extended <name> [view|check|run|configure|operation]\n  next <name> [view|check|run|configure]\n  shell <name>\n  exec <name> -- <command> [args...]\n  metrics <name>\n  clone <name> <new-name>\n  export <name> <file.sakura>\n  import <new-name> <file.sakura>\n  snapshots <name>\n  snapshot <name> <label>\n  project <name> <setup|start|stop|configure> [project.json]\n  sync <name> <both|push|pull|configure> [sync.json]\n\nStart the service with npm start first.',
    );
    console.log(
      '\nWorkspace management:\n  tasks\n  task <id> <cancel|retry|result>\n  storage\n  batch <start|stop> <name...>\n  organize <name> <organization.json>\n  diagnostics <name> [run]\n  resize <name> <GiB|finish>\n  backups <name>\n  backup <name> [run|verify|restore|delete] [backup-id] [new-name]\n  backup <name> configure <policy.json>\n  ide <name> [configure]\n  recipe <name> [read|write|apply] [sakura.json]\n  from-recipe <new-name> <sakura.json>\n  sync-preview <name>\n  sync-apply <name> <decisions.json>\n  project <name> <start|stop> [service-name]',
    );
    console.log(developmentHelp);
    console.log(sandboxHelp);
    console.log(
      '\nFile transfers:\n  download <name> <guest-file> <output-file>  (SHA-256 verified; automatically resumes interrupted downloads)',
    );
    return;
  }
  try {
    const authentication = await fetch(`${base}/api/bootstrap`);
    const bootstrap = await authentication.json();
    if (!authentication.ok) throw new Error(bootstrap.error || '无法获取控制凭证');
    if (typeof bootstrap.token !== 'string' || !bootstrap.token) throw new Error('服务返回了无效的访问凭证');
    async function api(path, method = 'GET', data) {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: { 'X-Sakura-Token': bootstrap.token, 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result;
    }
    if (action === 'plugins') {
      console.log(JSON.stringify(await api('/plugins'), null, 2));
      return;
    }
    if (action === 'plugin' || action === 'pack') {
      if (!['enable', 'disable'].includes(name) || !args[0] || args.length !== 1)
        throw new Error(`Usage: ${action} <enable|disable> <id>`);
      const status = await api('/plugins', 'PATCH', {
        kind: action,
        id: args[0],
        enabled: name === 'enable',
      });
      console.log(
        JSON.stringify({ planned: status.planned, restartRequired: status.restartRequired }, null, 2),
      );
      return;
    }
    if (action === 'sandbox' || action === 'sandboxes') {
      const result = await (await import('./sandbox-cli.mjs')).sandboxCommand(action, name, args, api);
      console.log(JSON.stringify(result.value, null, 2));
      return;
    }
    const development = ['list', 'create', 'start', 'stop', 'shell', 'exec'].includes(action)
      ? { handled: false }
      : await (await import('./development-cli.mjs')).developmentCommand(action, name, args, api, base);
    if (development.handled) {
      console.log(JSON.stringify(development.value, null, 2));
      return;
    }
    if (action === 'images') {
      console.table(await api('/images'));
      return;
    }
    if (action === 'tasks') {
      console.log(JSON.stringify(await api('/jobs'), null, 2));
      return;
    }
    if (action === 'events') {
      console.log(JSON.stringify(await api('/events'), null, 2));
      return;
    }
    if (action === 'task') {
      if (args[0] === 'result') {
        console.log(JSON.stringify(await api(`/jobs/${encodeURIComponent(name)}/result`), null, 2));
        return;
      }
      if (!['cancel', 'retry'].includes(args[0])) throw new Error('Usage: task <id> <cancel|retry|result>');
      console.log(await api(`/jobs/${encodeURIComponent(name)}/${args[0]}`, 'POST'));
      return;
    }
    if (action === 'storage') {
      console.log(JSON.stringify(await api('/storage'), null, 2));
      return;
    }
    if (action === 'from-recipe') {
      if (!args[0]) throw new Error('Usage: from-recipe <name> <sakura.json>');
      console.log(
        await api('/recipes', 'POST', { name, recipe: JSON.parse(await readFile(args[0], 'utf8')) }),
      );
      return;
    }
    if (action === 'image') {
      console.log(await api(`/images/${name}`, 'POST'));
      return;
    }
    if (action === 'create') {
      const distro = args[0] || 'alpine';
      console.log(
        await api('/vms', 'POST', {
          name,
          distro,
          template: args[1] || 'none',
          memoryMiB: distro === 'alpine' ? 512 : 1024,
        }),
      );
      return;
    }
    if (action === 'import') {
      if (!args[0]) throw new Error('Specify a .sakura file');
      const response = await fetch(`${base}/api/import?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: {
          'X-Sakura-Token': bootstrap.token,
          'Content-Type': 'application/octet-stream',
          ...(process.env.SAKURA_BACKUP_PASSWORD
            ? { 'X-Sakura-Passphrase': Buffer.from(process.env.SAKURA_BACKUP_PASSWORD).toString('base64') }
            : {}),
        },
        body: createReadStream(args[0]),
        duplex: 'half',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      console.log(result);
      return;
    }
    if (action === 'next' && name === 'catalog') {
      console.log(JSON.stringify(await api('/next-features'), null, 2));
      return;
    }
    const machines = await api('/vms');
    if (action === 'batch') {
      if (!['start', 'stop'].includes(name) || !args.length)
        throw new Error('Usage: batch <start|stop> <name...>');
      const ids = args.map((name) => {
        const vm = machines.find((v) => v.name === name || v.id === name);
        if (!vm) throw new Error(`Distribution not found: ${name}`);
        return vm.id;
      });
      console.log(await api('/vms/batch', 'POST', { ids, action: name }));
      return;
    }
    if (action === 'list') {
      console.table(
        machines.map((v) => ({
          name: v.name,
          status: v.status,
          cpu: v.cpus,
          memory: `${v.memoryMiB} MiB`,
          disk: `${v.diskGiB} GiB`,
        })),
      );
      return;
    }
    if (
      ![
        'start',
        'stop',
        'suspend',
        'resume',
        'extended',
        'next',
        'shell',
        'exec',
        'metrics',
        'clone',
        'export',
        'download',
        'snapshots',
        'snapshot',
        'project',
        'sync',
        'diagnostics',
        'resize',
        'backups',
        'backup',
        'ide',
        'recipe',
        'organize',
        'sync-preview',
        'sync-apply',
        'projects',
        'history',
        'pipeline',
        'runtimes',
        'code-check',
        'compact',
      ].includes(action)
    )
      throw new Error(`Unknown command: ${action}`);
    const vm = machines.find((v) => v.name === name || v.id === name);
    if (!vm) throw new Error(`Distribution not found: ${name}`);
    if (action === 'diagnostics') {
      console.log(await api(`/vms/${vm.id}/diagnostics`, args[0] === 'run' ? 'POST' : 'GET'));
      return;
    }
    if (action === 'resize') {
      console.log(
        await api(
          `/vms/${vm.id}/resize`,
          'POST',
          args[0] === 'finish' ? { finish: true } : { diskGiB: Number(args[0]) },
        ),
      );
      return;
    }
    if (action === 'backups') {
      console.log(JSON.stringify(await api(`/vms/${vm.id}/backups`), null, 2));
      return;
    }
    if (action === 'backup') {
      if (args[0] === 'configure')
        console.log(await api(`/vms/${vm.id}/backups`, 'PUT', JSON.parse(await readFile(args[1], 'utf8'))));
      else
        console.log(
          await api(`/vms/${vm.id}/backups`, 'POST', {
            action: args[0] || 'run',
            backupId: args[1],
            name: args[2],
            password: process.env.SAKURA_BACKUP_PASSWORD || undefined,
          }),
        );
      return;
    }
    if (action === 'ide') {
      console.log(await api(`/vms/${vm.id}/ide`, args[0] === 'configure' ? 'POST' : 'GET'));
      return;
    }
    if (action === 'organize') {
      console.log(
        await api(`/vms/${vm.id}/organization`, 'PUT', JSON.parse(await readFile(args[0], 'utf8'))),
      );
      return;
    }
    if (action === 'recipe') {
      if (args[0] === 'apply')
        console.log(await api(`/vms/${vm.id}/recipe`, 'PUT', JSON.parse(await readFile(args[1], 'utf8'))));
      else if (['read', 'write'].includes(args[0]))
        console.log(JSON.stringify(await api(`/vms/${vm.id}/recipe`, 'POST', { action: args[0] }), null, 2));
      else console.log(JSON.stringify(await api(`/vms/${vm.id}/recipe`), null, 2));
      return;
    }
    if (action === 'projects') {
      const kind = args[0] || 'list';
      if (kind === 'list') console.log(JSON.stringify(await api(`/vms/${vm.id}/projects`), null, 2));
      else if (kind === 'create') {
        if (!args[1] || !args[2])
          throw new Error('Usage: projects <name> create <project-name> <config.json>');
        console.log(
          await api(`/vms/${vm.id}/projects`, 'POST', {
            action: kind,
            name: args[1],
            config: JSON.parse(await readFile(args[2], 'utf8')),
          }),
        );
      } else if (kind === 'select') {
        if (!args[1]) throw new Error('Usage: projects <name> select <project-id>');
        console.log(await api(`/vms/${vm.id}/projects`, 'POST', { action: kind, projectId: args[1] }));
      } else if (kind === 'rename') {
        if (!args[1] || !args[2]) throw new Error('Usage: projects <name> rename <project-id> <name>');
        console.log(
          await api(`/vms/${vm.id}/projects`, 'POST', { action: kind, projectId: args[1], name: args[2] }),
        );
      } else throw new Error('Unknown project action');
      return;
    }
    if (action === 'history') {
      const kind = args[0] || '';
      if (!kind || !['restore', 'purge'].includes(kind)) {
        const path = kind ? `?path=${encodeURIComponent(kind)}` : '';
        console.log(JSON.stringify(await api(`/vms/${vm.id}/history${path}`), null, 2));
      } else {
        if (!args[1]) throw new Error(`Usage: history <name> ${kind} <history-id>`);
        console.log(
          await api(`/vms/${vm.id}/history`, 'POST', {
            action: kind,
            id: args[1],
            ...(args[2] ? { expectedVersion: args[2] } : {}),
          }),
        );
      }
      return;
    }
    if (action === 'pipeline') {
      const kind = args[0] || 'list';
      if (kind === 'list') console.log(JSON.stringify(await api(`/vms/${vm.id}/pipelines`), null, 2));
      else if (kind === 'save') {
        if (!args[1]) throw new Error('Usage: pipeline <name> save <pipeline.json>');
        console.log(await api(`/vms/${vm.id}/pipelines`, 'PUT', JSON.parse(await readFile(args[1], 'utf8'))));
      } else if (kind === 'run') {
        if (!args[1]) throw new Error('Usage: pipeline <name> run <pipeline-id>');
        console.log(await api(`/vms/${vm.id}/pipelines`, 'POST', { action: kind, pipelineId: args[1] }));
      } else if (kind === 'remove') {
        if (!args[1]) throw new Error('Usage: pipeline <name> remove <pipeline-id>');
        console.log(await api(`/vms/${vm.id}/pipelines`, 'DELETE', { id: args[1] }));
      } else throw new Error('Unknown pipeline action');
      return;
    }
    if (action === 'runtimes') {
      const kind = args[0] || 'inspect';
      if (kind === 'inspect') console.log(JSON.stringify(await api(`/vms/${vm.id}/runtimes`), null, 2));
      else if (kind === 'select') {
        if (!args[1]) throw new Error('Usage: runtimes <name> select <runtime.json>');
        console.log(
          await api(`/vms/${vm.id}/runtimes`, 'POST', {
            action: kind,
            ...JSON.parse(await readFile(args[1], 'utf8')),
          }),
        );
      } else if (kind === 'install') {
        if (!args[1] || !args[2]) throw new Error('Usage: runtimes <name> install <node|python> <version>');
        console.log(
          await api(`/vms/${vm.id}/runtimes`, 'POST', { action: kind, tool: args[1], version: args[2] }),
        );
      } else throw new Error('Unknown runtime action');
      return;
    }
    if (action === 'code-check') {
      console.log(
        JSON.stringify(
          await api(`/vms/${vm.id}/code-diagnostics${args[0] ? `?path=${encodeURIComponent(args[0])}` : ''}`),
          null,
          2,
        ),
      );
      return;
    }
    if (action === 'compact') {
      console.log(await api(`/vms/${vm.id}/compact`, 'POST', {}));
      return;
    }
    if (action === 'extended') {
      const kind = args[0] || 'view';
      if (kind === 'catalog') console.log(JSON.stringify(await api('/extended-features'), null, 2));
      else if (kind === 'view')
        console.log(JSON.stringify(await api(`/vms/${vm.id}/extended-features`), null, 2));
      else if (kind === 'check') {
        if (!args[1]) throw new Error('Usage: extended <name> check <feature-id>');
        console.log(
          await api(`/vms/${vm.id}/extended-features`, 'POST', { action: 'check', featureId: args[1] }),
        );
      } else if (kind === 'run') {
        if (!args[1]) throw new Error('Usage: extended <name> run <feature-id> [options.json]');
        const options = args[2] ? JSON.parse(await readFile(args[2], 'utf8')) : {};
        const { path, ...featureOptions } = options;
        console.log(
          await api(`/vms/${vm.id}/extended-features`, 'POST', {
            action: 'run',
            featureId: args[1],
            ...(path ? { path } : {}),
            options: featureOptions,
          }),
        );
      } else if (kind === 'configure') {
        if (!args[1] || !['true', 'false'].includes(args[2] || ''))
          throw new Error('Usage: extended <name> configure <feature-id> <true|false> [options.json]');
        const options = args[3] ? JSON.parse(await readFile(args[3], 'utf8')) : {};
        console.log(
          await api(`/vms/${vm.id}/extended-features`, 'POST', {
            action: 'configure',
            featureId: args[1],
            enabled: args[2] === 'true',
            options,
          }),
        );
      } else if (kind === 'operation') {
        if (!args[1]) throw new Error('Usage: extended <name> operation <operation.json>');
        console.log(
          await api(`/vms/${vm.id}/extended-features`, 'POST', {
            action: 'operation',
            ...JSON.parse(await readFile(args[1], 'utf8')),
          }),
        );
      } else throw new Error('Unknown extended action');
      return;
    }
    if (action === 'next') {
      const kind = args[0] || 'view';
      if (kind === 'catalog') console.log(JSON.stringify(await api('/next-features'), null, 2));
      else if (kind === 'view')
        console.log(JSON.stringify(await api(`/vms/${vm.id}/next-features`), null, 2));
      else if (kind === 'check') {
        if (!args[1]) throw new Error('Usage: next <name> check <feature-id> [options.json]');
        const options = args[2] ? JSON.parse(await readFile(args[2], 'utf8')) : {};
        console.log(
          await api(`/vms/${vm.id}/next-features`, 'POST', { action: 'check', featureId: args[1], options }),
        );
      } else if (kind === 'run') {
        if (!args[1]) throw new Error('Usage: next <name> run <feature-id> [options.json]');
        const options = args[2] ? JSON.parse(await readFile(args[2], 'utf8')) : {};
        console.log(
          await api(`/vms/${vm.id}/next-features`, 'POST', { action: 'run', featureId: args[1], options }),
        );
      } else if (kind === 'configure') {
        if (!args[1] || !['true', 'false'].includes(args[2] || ''))
          throw new Error('Usage: next <name> configure <feature-id> <true|false> [options.json]');
        const options = args[3] ? JSON.parse(await readFile(args[3], 'utf8')) : {};
        console.log(
          await api(`/vms/${vm.id}/next-features`, 'POST', {
            action: 'configure',
            featureId: args[1],
            enabled: args[2] === 'true',
            options,
          }),
        );
      } else throw new Error('Unknown next action');
      return;
    }
    if (action === 'sync-preview') {
      console.log(JSON.stringify(await api(`/vms/${vm.id}/sync-preview`, 'POST', {}), null, 2));
      return;
    }
    if (action === 'sync-apply') {
      console.log(
        await api(`/vms/${vm.id}/sync`, 'POST', {
          ...JSON.parse(await readFile(args[0], 'utf8')),
          direction: 'both',
        }),
      );
      return;
    }
    if (action === 'clone') {
      console.log(await api(`/vms/${vm.id}/clone`, 'POST', { name: args[0] }));
      return;
    }
    if (action === 'snapshots') {
      console.table(vm.snapshots);
      return;
    }
    if (action === 'snapshot') {
      console.log(await api(`/vms/${vm.id}/snapshots`, 'POST', { name: args[0] }));
      return;
    }
    if (action === 'download') {
      if (args.length !== 2) throw new Error('Usage: download <name> <guest-file> <output-file>');
      const { resumableDownload } = await import('./resumable-download.mjs');
      console.log(JSON.stringify(await resumableDownload(api, vm.id, args[0], args[1]), null, 2));
      return;
    }
    if (action === 'export') {
      if (!args[0]) throw new Error('Specify an output file');
      // Reserve the destination before asking the server to prepare a large disk.
      const file = await open(args[0], 'wx', 0o600);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      let complete = false;
      let identity;
      process.once('SIGINT', cancel);
      process.once('SIGTERM', cancel);
      try {
        identity = await file.stat();
        const response = await fetch(`${base}/api/vms/${vm.id}/export`, {
          headers: { 'X-Sakura-Token': bootstrap.token },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error((await response.json()).error);
        await pipeline(Readable.fromWeb(response.body), file.createWriteStream(), {
          signal: controller.signal,
        });
        complete = true;
      } finally {
        process.off('SIGINT', cancel);
        process.off('SIGTERM', cancel);
        await file.close();
        if (!complete && identity) {
          const current = await lstat(args[0]).catch(() => null);
          if (current?.dev === identity.dev && current.ino === identity.ino) await unlink(args[0]);
        }
      }
      console.log(`Exported to ${args[0]}`);
      return;
    }
    if ((action === 'project' || action === 'sync') && args[0] === 'configure') {
      if (!args[1]) throw new Error('Specify a JSON configuration file');
      console.log(await api(`/vms/${vm.id}/${action}`, 'PUT', JSON.parse(await readFile(args[1], 'utf8'))));
      return;
    }
    if (action === 'stop') {
      await api(`/vms/${vm.id}/stop`, 'POST', { force: false });
      console.log(`${vm.name} stopped`);
      return;
    }
    if (action === 'suspend' || action === 'resume') {
      await api(`/vms/${vm.id}/${action}`, 'POST');
      console.log(`${vm.name} ${action === 'suspend' ? 'suspended' : 'resumed'}`);
      return;
    }
    if (vm.status !== 'running') {
      console.error(`Starting ${vm.name}…`);
      await api(`/vms/${vm.id}/start`, 'POST');
      let ready = false;
      const deadline = Date.now() + 270_000;
      while (Date.now() < deadline) {
        const state = await api(`/vms/${vm.id}`);
        if (state.status === 'running') {
          ready = true;
          break;
        }
        if (['error', 'stopped', 'stopping'].includes(state.status))
          throw new Error(state.lastError || 'Guest stopped during boot');
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!ready) throw new Error('Linux startup timed out; inspect boot logs in the web console.');
    }
    if (action === 'start') {
      console.log(`${vm.name} ready`);
      return;
    }
    if (action === 'metrics') {
      console.log(await api(`/vms/${vm.id}/metrics`));
      return;
    }
    if (action === 'project' || action === 'sync') {
      const path = `/vms/${vm.id}/${action}`;
      const view = await api(path);
      if (view.job?.status === 'running')
        throw new Error('An operation is already running; inspect its progress in the web console.');
      await api(
        path,
        'POST',
        action === 'project'
          ? { action: args[0] || 'start', service: args[1] }
          : { direction: args[0] || 'both' },
      );
      let displayed = '';
      for (;;) {
        const state = (await api(path)).job;
        if (state.log !== displayed) {
          process.stdout.write(
            state.log.startsWith(displayed) ? state.log.slice(displayed.length) : state.log,
          );
          displayed = state.log;
        }
        if (['error', 'cancelled', 'interrupted'].includes(state.status)) throw new Error(state.error);
        if (state.status === 'done') return;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (action === 'exec') {
      const argv = args[0] === '--' ? args.slice(1) : args;
      if (!argv.length) throw new Error('Specify a command after --');
      const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
      const result = await api(`/vms/${vm.id}/exec`, 'POST', { command: argv.map(quote).join(' ') });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      process.exitCode = result.code < 0 ? 1 : result.code;
      return;
    }
    const socket = new WebSocket(
      `${base.replace('http:', 'ws:')}/ws/${vm.id}/terminal?token=${bootstrap.token}`,
    );
    const rawMode = Boolean(process.stdin.isTTY);
    const restore = () => {
      if (rawMode) process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const send = (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
    };
    const resize = () =>
      send({ type: 'resize', rows: process.stdout.rows || 24, cols: process.stdout.columns || 100 });
    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'data') process.stdout.write(msg.data);
      if (msg.type === 'error') console.error(msg.data);
      if (msg.type === 'ready') {
        resize();
        if (rawMode) process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', (data) => send({ type: 'input', data: data.toString() }));
        process.stdout.on('resize', resize);
      }
    });
    socket.on('close', () => {
      restore();
      process.exitCode ??= 0;
    });
    socket.on('error', (error) => {
      restore();
      console.error(error.message);
      process.exitCode = 1;
      socket.close();
    });
    process.on('SIGTERM', () => {
      restore();
      socket.close();
    });
  } catch (error) {
    console.error(
      `Sakura: ${error.message}. ${error.message === 'fetch failed' ? 'Run npm start first.' : ''}`,
    );
    process.exitCode = 1;
  }
}
await main();
