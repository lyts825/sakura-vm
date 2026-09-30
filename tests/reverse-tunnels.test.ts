import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { connect } from 'node:net';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ReverseTunnels } from '../server/reverse-tunnels.ts';
import { Machines } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import { projectSchema, type Project, type Workspaces } from '../server/workspaces.ts';

const id = '11111111-1111-4111-8111-111111111111';

class Guest extends EventEmitter {
  running = true;
  live = new Map([[id, {}]]);
  locks = new Machines({} as Engine);
  locked = this.locks.locked.bind(this.locks);
  commands: string[] = [];
  forwarded: Project[] = [];
  hanging = false;
  routeError = false;
  reservations = new Map<string, number[]>();
  state() { return this.running ? 'running' : 'stopped'; }
  get() { return { distro: 'alpine' }; }
  requireUnlocked() {}
  reserveHostPorts(owner: string, ports: number[]) { this.reservations.set(owner, ports); }
  async exec(_id: string, command: string, _timeout?: number, signal?: AbortSignal) {
    this.commands.push(command);
    if (this.hanging) await delay(60_000, undefined, { signal });
    return { code: 0, stdout: '', stderr: '' };
  }
  async openGuestTcpStream(_id: string, _port: number, signal?: AbortSignal, project?: Project) {
    if (this.routeError) throw new Error('项目命名空间已有网络路由');
    this.forwarded.push(project!);
    const stream = new PassThrough();
    signal?.addEventListener('abort', () => stream.destroy(), { once: true });
    return stream;
  }
}

function workspace() {
  const context = new AsyncLocalStorage<string>(), guards = new Set<(id: string, previous: Project, next: Project) => Promise<void>>();
  const alpha = '0123456789abcdef', beta = 'fedcba9876543210';
  const configs = new Map<string, Project>([
    ['default', projectSchema.parse({ directory: '/workspace/default' })],
    [alpha, { ...projectSchema.parse({ directory: '/workspace/alpha', networkIsolation: 'private',
      environment: { TOKEN: 'private-tunnel-value' }, secrets: { TOKEN: 'tunnel-key' } }), _workspace: alpha }],
    [beta, { ...projectSchema.parse({ directory: '/workspace/beta', networkIsolation: 'private' }), _workspace: beta }],
  ]);
  const config = async () => configs.get(context.getStore() || 'default')!;
  const workspaces = { config, resolvedConfig: config,
    projects: { current: () => context.getStore() || 'default',
      inScope: <T>(_id: string, project: string, action: () => T) => context.run(project, action) },
    beforeConfigChange: (guard: (id: string, previous: Project, next: Project) => Promise<void>) => {
      guards.add(guard); return () => guards.delete(guard);
    },
  } as unknown as Workspaces;
  return { workspaces, guards, configs, alpha, beta,
    inScope: <T>(project: string, action: () => T) => context.run(project, action) };
}

async function rejected(port: number) {
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
  }));
}

async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50 && !predicate(); attempt++) await delay(10);
  assert.equal(predicate(), true);
}

test('temporary TCP entrance forwards bytes and revokes on close, stop and lockdown', async () => {
  const guest = new Guest();
  const scope = workspace(), tunnels = new ReverseTunnels(guest as unknown as Machines, scope.workspaces);
  try {
    assert.equal((await tunnels.check(id)).ready, true);
    await assert.rejects(tunnels.open(id, 0, 10), /端口/);
    const opened = await tunnels.open(id, 8765, 10);
    assert.equal(opened.active, true);
    assert.ok(opened.localPort);
    const socket = connect(opened.localPort!, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    socket.write('ping');
    const [echo] = await once(socket, 'data');
    assert.equal(echo.toString(), 'ping');
    assert.equal(tunnels.status(id).active, true);
    assert.equal(await tunnels.stop(id), true);
    await eventually(() => socket.destroyed);
    await rejected(opened.localPort!);

    const stopped = await tunnels.open(id, 8765, 10);
    guest.running = false;
    guest.emit('change');
    await tunnels.stop(id);
    assert.equal((await tunnels.check(id)).ready, false);
    assert.equal(tunnels.status(id).active, false);
    await rejected(stopped.localPort!);

    guest.running = true;
    const locked = await tunnels.open(id, 8765, 10);
    guest.emit('incident-lockdown', id);
    await tunnels.stop(id);
    assert.equal(tunnels.status(id).active, false);
    await rejected(locked.localPort!);
  } finally {
    await tunnels.close();
  }
});

test('project tunnels keep independent bindings, protect configuration and preserve half-closed binary responses', async () => {
  const guest = new Guest(), scope = workspace();
  const tunnels = new ReverseTunnels(guest as unknown as Machines, scope.workspaces);
  try {
    const first = await scope.inScope(scope.alpha, () => tunnels.open(id, 8765, 10));
    const second = await scope.inScope(scope.beta, () => tunnels.open(id, 8765, 10));
    assert.equal(first.projectId, scope.alpha);
    assert.equal(first.networkIsolation, 'private');
    assert.notEqual(first.localPort, second.localPort);
    assert.equal(tunnels.status(id).active, false);
    assert.equal(await tunnels.stop(id), false, 'another project cannot close these tunnels');
    await assert.rejects(scope.inScope(scope.alpha, () => tunnels.open(id, 8766, 10)), /此项目已有/);
    const previous = scope.configs.get(scope.alpha)!;
    for (const guard of scope.guards) {
      await assert.rejects(guard(id, previous, { ...previous, networkIsolation: 'host' }), /先关闭.*隧道/);
      await guard(id, previous, { ...previous, environment: { TOKEN: 'new' } });
    }
    const socket = connect(first.localPort, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    const ended = once(socket, 'end');
    const bytes = Buffer.alloc(256 * 1024, 137);
    socket.end(bytes); await ended;
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal(guest.forwarded[0]._workspace, scope.alpha);
    assert.equal(guest.forwarded[0].environment, undefined);
    assert.equal(guest.forwarded[0].secrets, undefined);
    assert.ok(guest.commands.some((command) => command.includes(`ip netns exec sk-${scope.alpha}`)));
    scope.configs.set(scope.alpha, { ...previous, networkIsolation: 'host' });
    const changed = connect(first.localPort, '127.0.0.1');
    changed.on('error', () => {});
    await once(changed, 'close');
    assert.equal(guest.forwarded.length, 1, 'a changed binding cannot fall back to shared networking');
    scope.configs.set(scope.alpha, previous);
    guest.routeError = true;
    const routes = connect(first.localPort, '127.0.0.1');
    routes.on('error', () => {}); await once(routes, 'close');
    assert.equal(guest.forwarded.length, 1);
    guest.emit('incident-lockdown', id);
    await tunnels.close();
    await rejected(first.localPort); await rejected(second.localPort);
  } finally { await tunnels.close(); }
  assert.equal(scope.guards.size, 0);
});

test('shutdown aborts an unfinished tunnel setup and releases the instance lock', async () => {
  const guest = new Guest(), scope = workspace(); guest.hanging = true;
  const tunnels = new ReverseTunnels(guest as unknown as Machines, scope.workspaces);
  const operation = scope.inScope(scope.alpha, () => tunnels.open(id, 8765, 10));
  const rejected = assert.rejects(operation, /abort/i);
  await eventually(() => guest.commands.length > 0);
  await tunnels.close(); await rejected;
  assert.equal(guest.reservations.size, 0);
  await guest.locked(id, async () => {});
  await assert.rejects(tunnels.open(id, 8765, 10), /已关闭/);
});
