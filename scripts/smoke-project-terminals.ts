import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { chromium } from '@playwright/test';

const distro = process.argv[2] || 'alpine';
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(images[distro]);
const data = await mkdtemp(join(tmpdir(), 'sakura-terminal-scope-'));
assert.ok(resolve(data).startsWith(resolve(tmpdir()) + sep));
await writeFile(join(data, 'plugins.json'), JSON.stringify({ schemaVersion: 3,
  plugins: ['projects', 'terminal-workspace', 'automation', 'images'], packs: [] }));
const listener = createServer();
await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((done) => listener.close(() => done()));
const origin = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof spawn> | undefined, output = '', token = '';
let debugVm = '';
const sockets = new Set<WebSocket>();
async function start() {
  server = spawn(process.execPath, ['.sakura-server/index.js'], {
    cwd: resolve('.'), env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port),
      SAKURA_IMAGE_DIR: resolve('.data/images'), SAKURA_IMAGE_PATH: resolve('.data/images', images[distro]) },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  output = '';
  server.stdout?.on('data', (chunk) => { output += chunk; });
  server.stderr?.on('data', (chunk) => { output += chunk; });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(origin + '/api/access/status')).ok) return; } catch {}
    await delay(200);
  }
  throw new Error('Compiled terminal server did not start: ' + output);
}
async function stop() {
  for (const socket of sockets) socket.close();
  if (!server || server.exitCode !== null) return;
  const exited = new Promise<void>((done) => server!.once('exit', () => done()));
  server.kill('SIGTERM');
  await Promise.race([exited, delay(15000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
  await exited;
}
async function request(path: string, method = 'GET', body?: unknown, credential = token) {
  const response = await fetch(origin + path, { method,
    headers: { 'x-sakura-token': credential, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  return { status: response.status, body: await response.json() as any };
}
async function ok(path: string, method = 'GET', body?: unknown) {
  const result = await request(path, method, body);
  assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result));
  return result.body;
}
async function boot(id: string) {
  await ok(`/api/vms/${id}/start`, 'POST', {});
  const deadline = Date.now() + 300000;
  for (;;) {
    const current = await ok(`/api/vms/${id}`);
    if (current.status === 'running') return;
    assert.ok(!['error', 'stopped'].includes(current.status), JSON.stringify(current));
    assert.ok(Date.now() < deadline, 'VM startup timed out: ' + JSON.stringify(current) + '\n' + output);
    await delay(250);
  }
}
async function terminal(id: string, session: string | null, projectId?: string, viewerToken?: string) {
  const query = new URLSearchParams({ token: viewerToken || token });
  if (session) query.set('session', session);
  if (projectId) query.set('project', projectId);
  const socket = new WebSocket(origin.replace('http:', 'ws:') + `/ws/${id}/${viewerToken ? 'terminal-view' : 'terminal'}?${query}`, { handshakeTimeout: 10000 });
  sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  const messages: { type: string; data: any }[] = [];
  let failure: Error | undefined;
  socket.on('error', (error) => { failure = error; });
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  const deadline = Date.now() + 180000;
  while (!messages.some((item) => item.type === 'ready')) {
    if (failure || messages.some((item) => item.type === 'error') || socket.readyState === WebSocket.CLOSED)
      throw failure || new Error(JSON.stringify(messages));
    assert.ok(Date.now() < deadline, 'Terminal did not become ready'); await delay(100);
  }
  return { socket, messages, context: messages.find((item) => item.type === 'ready')!.data,
    input: (value: string) => socket.send(JSON.stringify({ type: 'input', data: value + '\n' })),
    close: async () => {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = new Promise<void>((done) => socket.once('close', () => done())); socket.close(); await closed;
    } };
}

try {
  await start(); token = (await ok('/api/bootstrap')).token;
  const vm = await ok('/api/vms', 'POST', { name: 'terminal-scope', distro, memoryMiB: 1024, cpus: 2, diskGiB: 4 });
  const id = vm.id as string;
  debugVm = id;
  const config = { directory: '/workspace/private', networkIsolation: 'private' };
  await ok(`/api/vms/${id}/project?project=default`, 'PUT', { directory: '/workspace/shared' });
  const index = await ok(`/api/vms/${id}/projects`, 'POST', { action: 'create', name: 'Private', config });
  const privateId = index.active as string;
  await boot(id);
  const guest = async (command: string) => {
    const result = await ok(`/api/vms/${id}/exec`, 'POST', { command });
    assert.equal(result.code, 0, result.stderr); return result.stdout.trim() as string;
  };
  const hostNamespace = await guest('readlink /proc/self/ns/net');
  const first = await terminal(id, 'main');
  assert.deepEqual(first.context, { projectId: privateId, networkIsolation: 'private' });
  first.input('readlink /proc/self/ns/net > terminal.ns; pwd > terminal.cwd; printf PRIVATE_HISTORY_MARKER');
  const ns = await guest(`ip netns exec sk-${privateId} readlink /proc/self/ns/net`);
  for (let attempt = 0; attempt < 50 && await guest('cat /workspace/private/terminal.ns 2>/dev/null || true') !== ns; attempt++) await delay(100);
  assert.equal(await guest('cat /workspace/private/terminal.ns'), ns);
  assert.equal(await guest('cat /workspace/private/terminal.cwd'), '/workspace/private');
  assert.notEqual(ns, hostNamespace);
  await first.close();
  assert.equal((await request(`/api/vms/${id}/project?project=${privateId}`, 'PUT', { ...config, directory: '/workspace/changed' })).status, 409);
  const shared = await terminal(id, 'main', 'default');
  assert.deepEqual(shared.context, { projectId: 'default', networkIsolation: 'host' });
  shared.input('readlink /proc/self/ns/net > terminal.ns');
  for (let attempt = 0; attempt < 50 && await guest('cat /workspace/shared/terminal.ns 2>/dev/null || true') !== hostNamespace; attempt++) await delay(100);
  assert.equal(await guest('cat /workspace/shared/terminal.ns'), hostNamespace);
  const resumed = await terminal(id, 'main', privateId);
  for (let attempt = 0; attempt < 50 && !resumed.messages.some((item) => item.type === 'data' && String(item.data).includes('PRIVATE_HISTORY_MARKER')); attempt++) await delay(100);
  assert.ok(resumed.messages.some((item) => item.type === 'data' && String(item.data).includes('PRIVATE_HISTORY_MARKER')));
  assert.ok(!shared.messages.some((item) => item.type === 'data' && String(item.data).includes('PRIVATE_HISTORY_MARKER')));
  await guest(`tmux split-window -t sakura-terminal-${privateId}-main:0`);
  await delay(300);
  const split = await terminal(id, 'main', privateId);
  await split.close();
  await guest(`tmux split-window -t sakura-terminal-${privateId}-main:0 'exec sleep 600'`);
  await assert.rejects(terminal(id, 'main', privateId), /网络空间/);
  await guest(`tmux kill-pane -t =sakura-terminal-${privateId}-main:.2`);
  await guest(`ip -n sk-${privateId} route add blackhole 203.0.113.0/24`);
  await assert.rejects(terminal(id, 'main', privateId), /网络路由/);
  await guest(`ip -n sk-${privateId} route del blackhole 203.0.113.0/24`);
  console.log(`${distro}: project namespaces, isolated history, reconnect and new-pane verification passed.`);

  const password = 'terminal scope owner password';
  await ok('/api/access/enable', 'POST', { password });
  token = (await ok('/api/access/login', 'POST', { username: 'owner', password })).token;
  const viewer = await ok('/api/access/users', 'POST', { username: 'terminal-reader',
    password: 'terminal scope viewer password', vmIds: [id], expiresAt: Date.now() + 3600000 });
  const viewerLogin = await ok('/api/access/login', 'POST', { username: 'terminal-reader', password: 'terminal scope viewer password' });
  const grant = await ok('/api/access/terminal-shares', 'POST', { vmId: id, session: 'main', viewerId: viewer.id, minutes: 5 });
  assert.equal(grant.projectId, privateId);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const viewedScopes: (string | null)[] = [];
    page.on('websocket', (socket) => {
      if (socket.url().includes('/terminal-view?')) viewedScopes.push(new URL(socket.url()).searchParams.get('project'));
    });
    await page.goto(origin);
    await page.getByLabel('账户名').fill('terminal-reader');
    await page.getByLabel('密码', { exact: true }).fill('terminal scope viewer password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '只读查看终端' }).click();
    await page.getByText('终端视图已连接', { exact: false }).waitFor();
    assert.deepEqual(viewedScopes, [privateId]);
    console.log(`${distro}: Chromium viewer attached to the exact project grant after server verification.`);
  } finally { await browser.close(); }
  const view = await terminal(id, 'main', privateId, viewerLogin.token);
  await assert.rejects(terminal(id, 'main', 'default', viewerLogin.token));
  view.input('touch /workspace/private/readonly-violation');
  for (let attempt = 0; attempt < 50 && view.socket.readyState !== WebSocket.CLOSED; attempt++) await delay(100);
  assert.equal(view.socket.readyState, WebSocket.CLOSED);
  await guest('test ! -e /workspace/private/readonly-violation');
  const revoke = await terminal(id, 'main', privateId, viewerLogin.token);
  await ok('/api/access/terminal-shares/' + grant.id, 'DELETE');
  for (let attempt = 0; attempt < 50 && revoke.socket.readyState !== WebSocket.CLOSED; attempt++) await delay(100);
  assert.equal(revoke.socket.readyState, WebSocket.CLOSED);
  const stale = await ok('/api/access/terminal-shares', 'POST', { vmId: id, session: 'main',
    viewerId: viewer.id, projectId: privateId, minutes: 5 });
  await ok(`/api/vms/${id}/terminal-session?project=${privateId}`, 'POST', { action: 'stop-all' });
  const replacement = await terminal(id, 'main', privateId);
  await assert.rejects(terminal(id, 'main', privateId, viewerLogin.token), /重新授权/);
  const renewed = await ok('/api/access/terminal-shares', 'POST', { vmId: id, session: 'main',
    viewerId: viewer.id, projectId: privateId, minutes: 5 });
  assert.equal(renewed.id, stale.id);
  assert.notEqual(renewed.terminalId, stale.terminalId);
  console.log(`${distro}: read-only scope, input rejection, revocation and replacement-session grants passed.`);
  const renewedView = await terminal(id, 'main', privateId, viewerLogin.token);
  await renewedView.close(); await replacement.close();
  await ok('/api/access/terminal-shares/' + renewed.id, 'DELETE');
  await resumed.close(); await shared.close();
  await ok(`/api/vms/${id}/terminal-session?project=${privateId}`, 'POST', { action: 'stop-all' });
  await guest('tmux has-session -t =sakura-terminal-default-main');
  await guest(`! tmux has-session -t =sakura-terminal-${privateId}-main 2>/dev/null`);
  await ok(`/api/vms/${id}/project?project=${privateId}`, 'PUT', { ...config, directory: '/workspace/changed' });
  const plain = await terminal(id, null, privateId);
  assert.equal((await request(`/api/vms/${id}/project?project=${privateId}`, 'PUT', { directory: '/workspace/changed', networkIsolation: 'host' })).status, 409);
  await plain.close(); await delay(200);
  await ok(`/api/vms/${id}/suspend`, 'POST', {});
  assert.equal((await request(`/api/vms/${id}/project?project=${privateId}`, 'PUT', { directory: '/workspace/changed', networkIsolation: 'host' })).status, 409);
  assert.equal((await request(`/api/vms/${id}/terminal-session?project=${privateId}`, 'POST', { action: 'stop-all' })).status, 409);
  await ok(`/api/vms/${id}/resume`, 'POST', {});
  await ok('/api/plugins', 'PATCH', { kind: 'plugin', id: 'automation', enabled: false });
  await ok('/api/plugins', 'PATCH', { kind: 'plugin', id: 'projects', enabled: false });
  // Persist a normal guest shutdown before restarting the controller. On
  // Windows terminating Node does not deliver a graceful SIGTERM handler.
  await ok(`/api/vms/${id}/stop`, 'POST', {});
  await stop(); await start();
  token = (await ok('/api/access/login', 'POST', { username: 'owner', password })).token;
  console.log(`${distro}: controller restarted without the projects plugin.`);
  await boot(id);
  assert.equal((await request(`/api/vms/${id}/project`)).status, 403);
  const fallback = await terminal(id, 'main');
  assert.deepEqual(fallback.context, { projectId: privateId, networkIsolation: 'private' });
  fallback.input('readlink /proc/self/ns/net > fallback.ns');
  for (let attempt = 0; attempt < 50 && !(await guest('cat /workspace/changed/fallback.ns 2>/dev/null || true')); attempt++) await delay(100);
  assert.equal(await guest('cat /workspace/changed/fallback.ns'), await guest(`ip netns exec sk-${privateId} readlink /proc/self/ns/net`));
  await fallback.close();
  await ok(`/api/vms/${id}/terminal-session`, 'POST', { action: 'stop-all' });
  console.log(`${distro}: scoped read-only grants, revocation, project-only cleanup, paused guards and disabled-plugin fallback passed.`);
} catch (error) {
  if (debugVm) {
    try { console.error(await request(`/api/vms/${debugVm}/exec`, 'POST', {
      command: "tmux list-sessions 2>&1; tmux list-panes -a -F '#{session_name} #{pane_pid} #{pane_dead} #{pane_current_command}' 2>&1; ip netns list" })); } catch {}
  }
  throw error;
} finally {
  if (debugVm && server?.exitCode === null && server.signalCode === null) {
    try { await request(`/api/vms/${debugVm}/stop`, 'POST', { force: true }); } catch {}
  }
  await stop();
  assert.ok(resolve(data).startsWith(resolve(tmpdir()) + sep));
  await rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
