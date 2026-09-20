#!/usr/bin/env node
import { WebSocket } from 'ws';
const base = `http://127.0.0.1:${process.env.SAKURA_PORT || 7337}`;
const [action = 'help', name, ...args] = process.argv.slice(2);
async function main() {
  if (action === 'help') {
    console.log(
      'Sakura — local Linux workspaces\n\n  list\n  start <name>\n  stop <name>\n  shell <name>\n  exec <name> -- <command> [args...]\n\nStart the service with npm start first.',
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
    if (!['start', 'stop', 'shell', 'exec'].includes(action)) throw new Error(`Unknown command: ${action}`);
    const vm = machines.find((v) => v.name === name || v.id === name);
    if (!vm) throw new Error(`Distribution not found: ${name}`);
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
