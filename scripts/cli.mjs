#!/usr/bin/env node
import { WebSocket } from 'ws';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const base = `http://127.0.0.1:${process.env.SAKURA_PORT || 7337}`;
const [action = 'help', name, ...args] = process.argv.slice(2);
async function main() {
  if (action === 'help') {
    console.log(
      'Sakura — local Linux workspaces\n\n  list\n  images\n  image <alpine|debian|ubuntu>\n  create <name> [alpine|debian|ubuntu] [none|node|python|rust]\n  start <name>\n  stop <name>\n  shell <name>\n  exec <name> -- <command> [args...]\n  metrics <name>\n  clone <name> <new-name>\n  export <name> <file.sakura>\n  import <new-name> <file.sakura>\n  snapshots <name>\n  snapshot <name> <label>\n  project <name> <setup|start|stop|configure> [project.json]\n  sync <name> <both|push|pull|configure> [sync.json]\n\nStart the service with npm start first.',
    );
    return;
  }
  try {
    const bootstrap = await fetch(`${base}/api/bootstrap`).then((r) => r.json());
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
    if (action === 'images') {
      console.table(await api('/images'));
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
        headers: { 'X-Sakura-Token': bootstrap.token, 'Content-Type': 'application/octet-stream' },
        body: createReadStream(args[0]),
        duplex: 'half',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      console.log(result);
      return;
    }
    const machines = await api('/vms');
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
        'shell',
        'exec',
        'metrics',
        'clone',
        'export',
        'snapshots',
        'snapshot',
        'project',
        'sync',
      ].includes(action)
    )
      throw new Error(`Unknown command: ${action}`);
    const vm = machines.find((v) => v.name === name || v.id === name);
    if (!vm) throw new Error(`Distribution not found: ${name}`);
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
    if (action === 'export') {
      if (!args[0]) throw new Error('Specify an output file');
      const response = await fetch(`${base}/api/vms/${vm.id}/export`, {
        headers: { 'X-Sakura-Token': bootstrap.token },
      });
      if (!response.ok) throw new Error((await response.json()).error);
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(args[0], { flags: 'wx', mode: 0o600 }),
      );
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
        action === 'project' ? { action: args[0] || 'start' } : { direction: args[0] || 'both' },
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
        if (state.status === 'error') throw new Error(state.error);
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
