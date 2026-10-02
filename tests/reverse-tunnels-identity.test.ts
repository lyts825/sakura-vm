import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter, once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { connect, createServer } from 'node:net';
import { Duplex, PassThrough, Transform } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ReverseTunnels, reverseTunnelSessionSchema } from '../server/reverse-tunnels.ts';
import { reverseTunnelAdapterCommand, reverseTunnelAdapterInput, reverseTunnelListenerCommand,
  reverseTunnelBrokerCommand, openReverseTunnelBridge } from '../server/reverse-tunnel-transport.ts';
import { ProjectReverseTunnelScope, projectReverseTunnelScopePaths } from '../server/project-service-scope.ts';
import { AppError, VM_ROOT, vmDir } from '../server/model.ts';
import { ProjectRunScopes } from '../server/project-run-scope.ts';
import type { ProjectReverseTunnelRecord } from '../server/project-service-scope.ts';
import type { Machines } from '../server/machines.ts';
import { projectSchema, type Project, type Workspaces } from '../server/workspaces.ts';
import { reverseTunnelIdentityOptions } from './reverse-tunnel-identity-fixture.ts';

const alpha = '0123456789abcdef', beta = 'fedcba9876543210';
const signal = () => new AbortController().signal;
const copy = (project: Project, scope = project._workspace) => Object.defineProperty(structuredClone(project), '_workspace', { value: scope, enumerable: false });
async function fixture(t: Parameters<typeof reverseTunnelIdentityOptions>[0], mode: 'host' | 'private' = 'private', selected = alpha) {
  const id = randomUUID(), live = {}, context = new AsyncLocalStorage<string>(), roots: string[] = [], reservations = new Map<string, number[]>();
  let running = true, outside = selected, forced: string | undefined;
  const configs = new Map<string, Project>([alpha, beta, 'default'].map(scope => [scope,
    copy(projectSchema.parse({ directory: '/workspace/' + scope, networkIsolation: mode,
      environment: { MODE: 'original', PATH: '/project/runtime/bin:/usr/bin:/bin', BASH_ENV: 'private-init;$(id)' },
      secrets: { TOKEN: 'reverse-secret-key' } }), scope === 'default' ? undefined : scope)]));
  const guards = new Set<(id: string, old: Project, next: Project) => Promise<void>>();
  const machines = Object.assign(new EventEmitter(), { live: new Map([[id, live]]), state: () => running ? 'running' : 'stopped',
    get: () => ({ distro: 'debian' }), requireUnlocked() {}, reserveHostPorts(owner: string, ports: number[]) { reservations.set(owner, ports); },
    locked: async (_id: string, action: () => Promise<unknown>) => action(),
    exec: async (_id: string, command: string) => { roots.push(command); throw new Error('Unexpected project root execution'); },
    execInput: async () => { throw new Error('Unexpected root project input'); },
    writeGuestFile: async () => { throw new Error('Unexpected automatic project directory migration'); },
  }) as unknown as Machines;
  const workspaces = { projects: { current: () => forced || context.getStore() || outside,
    inScope: <T>(_id: string, scope: string, action: () => T) => context.run(scope, action) },
    config: async () => copy(configs.get(forced || context.getStore() || outside)!),
    resolvedConfig: async () => { throw new Error('Captured project must not be reselected'); },
    resolveProject: async (_id: string, captured: Project) => {
      ++model.state.resolutions; return copy({ ...captured, environment: { ...captured.environment, TOKEN: 'private-reverse-secret-雪' } }, captured._workspace); },
    beforeConfigChange: (guard: (id: string, old: Project, next: Project) => Promise<void>) => { guards.add(guard); return () => guards.delete(guard); },
  } as unknown as Workspaces;
  const cleanup: (() => Promise<unknown>)[] = [];
  const model = await reverseTunnelIdentityOptions({ after: action => cleanup.push(action) }, machines, workspaces),
    tunnels = new ReverseTunnels(machines, workspaces, model.options);
  t.after(async () => { running = true; forced = undefined; model.state.cleanupFailures = model.state.releaseFailures = model.state.closeFailures = 0;
    model.state.proofHook = model.state.bridgeHook = undefined; await tunnels.close(); for (const action of cleanup) await action(); });
  return { id, live, machines, workspaces, model, tunnels, roots, reservations, configs, guards,
    inScope: <T>(scope: string, action: () => T) => context.run(scope, action),
    setRunning: (value: boolean) => { running = value; }, switchOutside: (scope: string) => { outside = scope; },
    forceScope: (scope?: string) => { forced = scope; }, open: (duration = 10, abort?: AbortSignal) => tunnels.open(id, 8765, duration, abort) };
}
async function eventually(action: () => boolean) { for (let n = 0; n < 100 && !action(); ++n) await delay(10); assert.ok(action()); }
async function refused(port: number) { const socket = connect(port, '127.0.0.1'); socket.on('error', () => {});
  await new Promise<void>(resolve => socket.once('close', () => resolve())); }
async function crash(f: Awaited<ReturnType<typeof fixture>>) {
  const internals = f.tunnels as any;
  for (const tunnel of internals.tunnels.values()) await internals.revoke(tunnel);
  // Simulate a host process disappearing without stopping its persisted guest owner.
  internals.tunnels.clear(); internals.records = []; internals.closed = true; internals.controller.abort(); internals.unguard();
  f.machines.removeAllListeners('change'); f.machines.removeAllListeners('incident-lockdown'); f.model.held.clear();
}
function proof(f: Awaited<ReturnType<typeof fixture>>, scope = alpha) {
  const record = f.model.records.get(scope)!, account = f.model.identities.get(scope)!;
  return { identity: account, run: f.model.tickets.get(record.runId)!, listener: { port: 23000 + account.uid - 21000,
    pid: 1234, startTicks: '987', socketInode: '888' }, token: 'c'.repeat(64) };
}

test('original named UID, home and complete durable intent precede the first broker frame', async t => {
  const f = await fixture(t); const opened = await f.open(); const row = (await f.model.read()).sessions[0];
  reverseTunnelSessionSchema.parse(row); assert.equal(row.projectId, alpha); assert.equal(row.localPort, opened.localPort);
  assert.equal(row.execution.identity.uid, row.execution.identity.gid); assert.notEqual(row.execution.identity.uid, 0);
  assert.match(row.execution.identity.home, /^\/var\/lib\/sakura-project-homes\/[a-f0-9-]{36}$/);
  assert.deepEqual(row.execution.run, f.model.tickets.get(row.execution.record.runId));
  assert.equal(f.model.held.get(alpha), 1); assert.equal(f.model.state.resolutions, 1);
  assert.equal(f.model.executions.every(value => value.project._workspace === alpha && !Object.keys(value.project).includes('_workspace')), true);
  assert.ok(f.model.events.indexOf(alpha + ':outer-intent') < f.model.events.indexOf(alpha + ':native-intent'));
  assert.ok(f.model.events.indexOf(alpha + ':native-intent') < f.model.events.indexOf(alpha + ':broker-start'));
  const frame = f.model.frames[0]; assert.equal(createHash('sha256').update(frame).digest('hex'), row.execution.sha256);
  assert.ok(frame.includes(Buffer.from('private-reverse-secret-雪')) && frame.includes(Buffer.from('private-init;$(id)')));
  assert.ok(f.model.rootLaunches.every(command => !command.includes('private-') && !command.includes(row.token)));
  assert.deepEqual(f.roots, []); assert.equal(opened.host, '127.0.0.1');
  const other = await f.inScope(beta, () => f.tunnels.open(f.id, 8766, 10)); assert.notEqual(other.localPort, opened.localPort);
  assert.notEqual(f.model.identities.get(alpha)!.uid, f.model.identities.get(beta)!.uid);
  assert.notEqual(f.model.identities.get(alpha)!.home, f.model.identities.get(beta)!.home);
});

test('view retains a false readiness result and explicit directory migration never invokes root fallback', async t => {
  const f = await fixture(t); f.model.state.probeCode = 1; f.model.state.probeStderr = 'private-reverse-secret-雪 unavailable';
  assert.equal((await f.tunnels.check(f.id)).ready, false);
  await assert.rejects(f.open(), error => error instanceof Error && !error.message.includes('private-reverse-secret-雪'));
  f.model.state.probeCode = 0; f.model.state.identityFailure = true;
  await assert.rejects(f.open(), (error: any) => error.code === 'PROJECT_DIRECTORY_MIGRATION_REQUIRED');
  assert.equal(f.model.state.starts, 0); assert.equal(f.model.state.releases, 3); assert.deepEqual(f.roots, []);
});

test('live replacement during the first config read is rejected before any preparation', async t => {
  const f = await fixture(t), original = f.workspaces.config.bind(f.workspaces);
  f.workspaces.config = async id => { const config = await original(id); f.machines.live.set(id, {} as any); return config; };
  await assert.rejects(f.open(), (error: any) => error.code === 'SERVICE_SCOPE_CHANGED');
  assert.equal(f.model.state.preparations, 0); assert.equal(f.model.executions.length, 0); assert.deepEqual(f.roots, []);
});

test('configuration or selected-scope changes after the finite probe cannot launch the broker', async t => {
  for (const change of ['config', 'scope']) {
    const f = await fixture(t); f.model.state.taskHook = async () => {
      if (change === 'scope') f.forceScope(beta); else f.configs.get(alpha)!.environment!.MODE = 'changed'; };
    await assert.rejects(f.open(), (error: any) => error.code === 'SERVICE_SCOPE_CHANGED'); f.forceScope();
    assert.equal(f.model.state.starts, 0); assert.equal(f.model.state.releases, 1); assert.deepEqual(f.roots, []);
  }
});

test('bounded protected probe input rejects NUL and oversize environment before any execution', async t => {
  for (const content of ['bad\0value', 'x'.repeat(8193)]) {
    const f = await fixture(t); f.configs.get(alpha)!.environment!.BAD = content;
    await assert.rejects(f.open(), (error: any) => error.status === 413 && error.code === 'PROJECT_IDENTITY_PAYLOAD_INVALID');
    assert.equal(f.model.executions.length, 0); assert.equal(f.model.state.releases, 1); assert.deepEqual(f.roots, []);
  }
});

test('ticket build, listener PID and captured environment changes refuse new connections', async t => {
  for (const mutation of ['ticket', 'listener', 'environment']) {
    const f = await fixture(t), opened = await f.open(), record = f.model.records.get(alpha)!;
    if (mutation === 'ticket') f.model.tickets.get(record.runId)!.build = 'b'.repeat(64);
    if (mutation === 'listener') f.model.state.listenerChanged = true;
    if (mutation === 'environment') f.configs.get(alpha)!.environment!.MODE = 'changed';
    await refused(opened.localPort); assert.equal(f.model.bridges.length, 0);
    await assert.rejects(f.tunnels.check(f.id)); assert.deepEqual(f.roots, []);
  }
});

test('failed full-domain stop revokes localhost and retains the original ticket, lease and retry record', async t => {
  const f = await fixture(t), opened = await f.open(), original = (await f.model.read()).sessions[0];
  f.model.state.cleanupFailures = 1;
  await assert.rejects(f.tunnels.stop(f.id), (error: any) => error.status === 503 && error.code === 'SERVICE_CLEANUP_FAILED');
  const retained = (await f.model.read()).sessions[0]; assert.equal(retained.phase, 'stopping');
  assert.deepEqual(retained.execution, original.execution); assert.equal(f.model.held.get(alpha), 1);
  assert.equal(f.model.members.get(original.execution.run.runId)!.size, 3); assert.equal(f.model.state.releases, 0);
  assert.equal(f.tunnels.status(f.id).active, false); await refused(opened.localPort);
  await assert.rejects(f.open(), /此项目已有/); assert.equal(await f.tunnels.stop(f.id), true);
  assert.deepEqual((await f.model.read()).sessions, []); assert.equal(f.model.members.size, 0);
  assert.equal(f.model.tickets.get(original.execution.run.runId)!.phase, 'closed'); assert.equal(f.model.state.releases, 1);
  assert.ok(f.model.events.indexOf(alpha + ':native-ticket-retired') < f.model.events.indexOf(alpha + ':release'));
});

test('lost broker startup acknowledgment retains the original lease before a localhost listener exists', async t => {
  const f = await fixture(t), create = f.model.options.processScope!;
  f.model.options.processScope = (...args) => {
    const scope = create(...args), start = scope.start;
    scope.start = async (...values) => { await start(...values); throw new Error('broker startup acknowledgment lost'); };
    return scope;
  };
  f.model.state.cleanupFailures = 1;
  await assert.rejects(f.open(), (error: any) => error.status === 503);
  const row = (await f.model.read()).sessions[0], runId = row.execution.record.runId;
  assert.equal(row.phase, 'stopping'); assert.equal(row.localPort, 0); assert.equal(row.execution.run, null);
  assert.equal(f.model.members.get(runId)!.size, 3); assert.equal(f.model.tickets.get(runId)!.phase, 'active');
  assert.equal(f.model.held.get(alpha), 1); assert.equal(f.model.state.releases, 0);
  assert.equal(f.tunnels.status(f.id).active, false); assert.equal(f.reservations.size, 0);
  await assert.rejects(f.open(), /此项目已有/);
  assert.equal(await f.tunnels.stop(f.id), true); assert.deepEqual((await f.model.read()).sessions, []);
  assert.equal(f.model.members.size, 0); assert.equal(f.model.tickets.get(runId)!.phase, 'closed');
  assert.equal(f.model.held.get(alpha), 0); assert.equal(f.model.state.releases, 1);
  assert.ok(f.model.events.indexOf(alpha + ':native-ticket-retired') < f.model.events.indexOf(alpha + ':release'));
});

test('readonly reload proves the original ticket before preparing a verification-only binding lease', async t => {
  const f = await fixture(t); await f.open(); await crash(f);
  let preparations = 0; const create = f.model.options.createPreparation!;
  f.model.options.createPreparation = () => {
    const manager = create(), prepare = manager.prepare;
    manager.prepare = async (...args) => {
      ++preparations; assert.ok(f.model.proofCalls.length > 0); assert.deepEqual(args[6], { mode: 'task', verifyOnly: true });
      return prepare(...args);
    }; return manager;
  };
  const reload = new ReverseTunnels(f.machines, f.workspaces, f.model.options); t.after(() => reload.close());
  await reload.check(f.id); assert.equal(preparations, 1); assert.equal(reload.status(f.id).active, true);
  assert.equal(f.model.state.starts, 1); assert.equal(f.model.executions.length, 2); await reload.stop(f.id);
});

test('changed on-disk host session is neither overwritten nor served from stale in-memory authority', async t => {
  const f = await fixture(t), opened = await f.open(), original = await f.model.read(), changed = structuredClone(original);
  changed.sessions[0].token = 'f'.repeat(64); await writeFile(f.model.file, JSON.stringify(changed));
  assert.equal(f.tunnels.status(f.id).active, false); await refused(opened.localPort); assert.equal(f.model.bridges.length, 0);
  await assert.rejects(f.tunnels.check(f.id), (error: any) => error.code === 'SERVICE_SCOPE_CHANGED');
  await assert.rejects(f.tunnels.stop(f.id), (error: any) => error.status === 503);
  assert.deepEqual(await f.model.read(), changed); assert.equal(f.model.state.releases, 0);
  await writeFile(f.model.file, JSON.stringify(original)); await f.tunnels.stop(f.id);
});

test('lease release and manager close failures are both preserved as 503 and remain retryable', async t => {
  const f = await fixture(t); await f.open(); f.model.state.releaseFailures = f.model.state.closeFailures = 1;
  await assert.rejects(f.tunnels.stop(f.id), (error: any) => error.status === 503 &&
    error.errors.some((cause: Error) => cause.message.includes('lease release')) && error.errors.some((cause: Error) => cause.message.includes('preparation close')));
  assert.equal((await f.model.read()).sessions[0].phase, 'stopping'); assert.equal(f.model.held.get(alpha), 1);
  assert.equal(await f.tunnels.stop(f.id), true); assert.equal(f.model.held.get(alpha), 0);
});

test('cancelling setup closes finite task preparation while cancelling an already returned request preserves the lifetime', async t => {
  const f = await fixture(t), abort = new AbortController(); let entered = false;
  f.model.state.taskHook = async () => { entered = true; await delay(60000, undefined, { signal: abort.signal }); };
  const pending = f.open(10, abort.signal), rejected = assert.rejects(pending, (error: any) => error.name === 'AbortError');
  await eventually(() => entered); abort.abort(); await rejected;
  assert.equal(f.model.state.releases, 1); assert.equal(f.model.state.starts, 0);
  f.model.state.taskHook = undefined; const finished = new AbortController(), opened = await f.open(10, finished.signal); finished.abort();
  assert.equal(f.tunnels.status(f.id).active, true);
  const socket = connect(opened.localPort, '127.0.0.1'); socket.on('error', () => {}); const data = once(socket, 'data'); socket.end(Buffer.from([0, 255, 0, 10]));
  assert.deepEqual((await data)[0], Buffer.from([0, 255, 0, 10])); socket.destroy();
});

test('service close retries a retained 503 without erasing the original full-domain receipt', async t => {
  const f = await fixture(t); await f.open(); f.model.state.cleanupFailures = 1;
  await assert.rejects(f.tunnels.close(), (error: any) => error.status === 503); assert.equal(f.guards.size, 1);
  await f.tunnels.close(); assert.equal(f.guards.size, 0); assert.deepEqual((await f.model.read()).sessions, []);
});

test('known restart preserves the original localhost port and full proof; another scope cannot see or stop it', async t => {
  const f = await fixture(t), opened = await f.open(), original = (await f.model.read()).sessions[0]; await crash(f);
  const reload = new ReverseTunnels(f.machines, f.workspaces, f.model.options); t.after(() => reload.close());
  f.switchOutside(beta); assert.equal(reload.status(f.id).active, false); assert.equal(await reload.stop(f.id), false);
  await f.inScope(alpha, () => reload.check(f.id));
  assert.equal(f.inScope(alpha, () => reload.status(f.id)).active, true);
  assert.deepEqual((await f.model.read()).sessions[0], original); assert.equal(f.model.state.starts, 1);
  const socket = connect(opened.localPort, '127.0.0.1'); socket.on('error', () => {}); const data = once(socket, 'data'); socket.end('original');
  assert.equal((await data)[0].toString(), 'original'); socket.destroy(); await f.inScope(alpha, () => reload.stop(f.id));
});

test('restart refuses old boot and reused labels; explicit stop retains that record until exact retirement', async t => {
  const f = await fixture(t); await f.open(); const original = (await f.model.read()).sessions[0]; await crash(f);
  f.model.state.bootId = randomUUID(); f.model.state.coldBootBlocked = true;
  const reload = new ReverseTunnels(f.machines, f.workspaces, f.model.options); t.after(() => reload.close());
  await assert.rejects(reload.check(f.id)); assert.equal(reload.status(f.id).active, false);
  await assert.rejects(reload.stop(f.id), (error: any) => error.status === 503);
  assert.deepEqual((await f.model.read()).sessions[0].execution, original.execution);
  f.model.state.coldBootBlocked = false; await reload.stop(f.id); assert.deepEqual((await f.model.read()).sessions, []);
});

test('unproven root or unknown records are retained and never represented as recovered UID entrances', async t => {
  const f = await fixture(t), row = { id: randomUUID(), vmId: f.id, projectId: alpha, directory: '/workspace/' + alpha,
    networkIsolation: 'private', guestPort: 8765, localPort: 23100, phase: 'review',
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
  await writeFile(f.model.file, JSON.stringify({ version: 1, sessions: [row] }));
  const old = new ReverseTunnels(f.machines, f.workspaces, f.model.options); t.after(() => old.close());
  assert.equal(old.status(f.id).active, false); await assert.rejects(old.check(f.id), (error: any) => error.code === 'PROJECT_IDENTITY_REQUIRED');
  await assert.rejects(old.stop(f.id), (error: any) => error.code === 'PROJECT_IDENTITY_REQUIRED'); await old.close();
  assert.deepEqual((await f.model.read()).sessions, [row]); assert.equal(f.model.state.starts, 0);
});

test('a slow binary response preserves backpressure and half-closed input through the original localhost API', async t => {
  const f = await fixture(t, 'host'); let drains = 0;
  f.model.options.bridge = async (...args) => { await args[5](); f.model.bridges.push(args);
    const stream = new Transform({ highWaterMark: 1024, transform(chunk, _encoding, done) { setTimeout(() => done(null, chunk), 1); } });
    stream.on('drain', () => ++drains); args[4].addEventListener('abort', () => stream.destroy(), { once: true }); return stream; };
  const opened = await f.open(), socket = connect(opened.localPort, '127.0.0.1');
  socket.on('error', () => {}); await once(socket, 'connect'); socket.pause(); const bytes = Buffer.alloc(2 * 1024 * 1024);
  for (let index = 0; index < bytes.length; ++index) bytes[index] = index % 256;
  const chunks: Buffer[] = []; socket.on('data', data => chunks.push(data)); const ended = once(socket, 'end');
  socket.write(bytes); socket.end();
  await delay(25); socket.resume(); await ended; assert.deepEqual(Buffer.concat(chunks), bytes); socket.destroy();
  assert.ok(drains > 0, 'slow finite bridge writes must drain before forwarding more input');
  assert.equal(f.model.bridges.length, 1); assert.equal(f.model.bridges[0][2].run.namespace, '');
});

test('the original localhost listener admits four owned connections and releases a slot after EOF', async t => {
  const f = await fixture(t), opened = await f.open(), clients: ReturnType<typeof connect>[] = [];
  for (let n = 0; n < 4; ++n) { const socket = connect(opened.localPort, '127.0.0.1'); socket.on('error', () => {});
    clients.push(socket); await once(socket, 'connect'); }
  await eventually(() => f.model.bridges.length === 4); await refused(opened.localPort);
  assert.equal(f.model.bridges.length, 4); clients[0].end(); await eventually(() => clients[0].destroyed);
  const fifth = connect(opened.localPort, '127.0.0.1'); fifth.on('error', () => {}); clients.push(fifth); await once(fifth, 'connect');
  await eventually(() => f.model.bridges.length === 5); for (const socket of clients) socket.destroy();
});

test('TTL retires every modeled descendant and original ticket before releasing the long preparation lease', async t => {
  const f = await fixture(t); const scope = f.model.options.processScope!;
  f.model.options.processScope = (...args) => { const process = scope(...args); const start = process.start;
    process.start = async (...values) => { const record = await start(...values); process.expiresAt = () => new Date(Date.now() + 150).toISOString(); return record; }; return process; };
  const opened = await f.open(); await eventually(() => f.model.state.releases === 1);
  await f.tunnels.stop(f.id);
  assert.equal(f.model.members.size, 0); assert.equal(f.tunnels.status(f.id).active, false); await refused(opened.localPort);
  assert.deepEqual((await f.model.read()).sessions, []);
});

test('root socket adapter uses one static argv and bounded inert metadata, with no project environment or destination command', async t => {
  const f = await fixture(t); await f.open(); const owner = proof(f), frame = reverseTunnelAdapterInput(owner);
  assert.equal(frame.input.subarray(0, 8).toString(), 'SKRTCP01'); assert.ok(frame.input.readUInt32LE(8) <= 8192);
  const metadata = JSON.parse(frame.input.subarray(12).toString()); assert.equal(metadata.uid, owner.identity.uid);
  assert.equal(metadata.cgroupInode, owner.run.cgroupInode); assert.equal(metadata.listener.socketInode, '888');
  assert.equal(metadata.token, owner.token); assert.equal(metadata.environment, undefined);
  assert.ok(!reverseTunnelAdapterCommand.includes(owner.token) && !reverseTunnelAdapterCommand.includes('/workspace/'));
  assert.ok(!reverseTunnelListenerCommand(owner.identity, owner.run).includes('private-'));
  await assert.rejects(Promise.resolve().then(() => reverseTunnelAdapterInput({ ...owner, token: 'z'.repeat(64) })));
});

test('adapter rejects a live replacement after SSH connect and closes an interrupted metadata write', async t => {
  const f = await fixture(t); await f.open(); const owner = proof(f);
  class Channel extends Duplex { stderr = new PassThrough(); _read() {} _write(_chunk: Buffer, _encoding: BufferEncoding, _done: (error?: Error | null) => void) {} }
  const channel = new Channel(), emitter = new EventEmitter(), client = Object.assign(emitter, { destroyed: false,
    exec(command: string, callback: (error: Error | undefined, channel: unknown) => void) { assert.equal(command, reverseTunnelAdapterCommand); callback(undefined, channel); },
    destroy() { this.destroyed = true; emitter.emit('close'); }, end() {} });
  const machine = f.machines as any; machine.connect = async () => { machine.live.set(f.id, {}); return client; };
  await assert.rejects(openReverseTunnelBridge(f.machines, f.id, owner, f.live, signal(), async () => {}), (error: any) => error.code === 'SERVICE_SCOPE_CHANGED');
  assert.equal(client.destroyed, true); machine.live.set(f.id, f.live); client.destroyed = false;
  machine.connect = async () => client; const abort = new AbortController(); let checks = 0;
  const pending = openReverseTunnelBridge(f.machines, f.id, owner, f.live, abort.signal, async () => { ++checks; });
  const rejected = assert.rejects(pending, (error: any) => error.name === 'AbortError'); await eventually(() => checks >= 3); abort.abort(); await rejected;
  assert.equal(channel.destroyed, true); assert.equal(client.destroyed, true);
});

test('generated Python broker, read-only proof and root socket adapter compile without importing project files', async t => {
  const python = spawnSync('python', ['--version'], { encoding: 'utf8' }); if (python.status !== 0) return t.skip('Host Python unavailable; no VM was started');
  const f = await fixture(t); await f.open(); const owner = proof(f);
  const unquote = (value: string) => value.slice(1, -1).replaceAll("'\\''", "'");
  const shell = unquote(reverseTunnelAdapterCommand.split('/bin/sh -ec ')[1]);
  const sources = [unquote(reverseTunnelBrokerCommand(8765, owner.token, 10).split('/usr/bin/python3 -I -S -u -c ')[1]),
    unquote(reverseTunnelListenerCommand(owner.identity, owner.run).split('/usr/bin/python3 -I -S -c ')[1]),
    unquote(shell.split('/usr/bin/python3 -I -S -u -c ')[1])];
  for (const source of sources) { const result = spawnSync('python', ['-I', '-S', '-c', 'import sys;compile(sys.stdin.read(),"reverse-generated","exec")'],
    { input: source, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); }
});

test('actual host Python broker authenticates its preface and preserves binary EOF and delayed response', async t => {
  const python = spawnSync('python', ['--version'], { encoding: 'utf8' }); if (python.status !== 0) return t.skip('Host Python unavailable; no VM was started');
  const f = await fixture(t), token = 'd'.repeat(64), bytes = Buffer.alloc(512 * 1024);
  for (let index = 0; index < bytes.length; ++index) bytes[index] = index % 256;
  let received: Buffer | undefined; const backend = createServer({ allowHalfOpen: true }, socket => { const chunks: Buffer[] = [];
    socket.on('data', chunk => chunks.push(chunk)); socket.on('end', () => { const complete = Buffer.concat(chunks);
      received = complete; setTimeout(() => socket.end(complete), 25); }); });
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve)); const port = (backend.address() as { port: number }).port;
  const quoted = reverseTunnelBrokerCommand(port, token, 10).split('/usr/bin/python3 -I -S -u -c ')[1];
  const source = quoted.slice(1, -1).replaceAll("'\\''", "'").replace('server.settimeout(.5)', 'server.settimeout(.5)\nprint(server.getsockname()[1],flush=True)');
  const file = join(dirname(f.model.file), 'host-broker-model.py'); await writeFile(file, source);
  const child = spawn('python', ['-I', '-S', '-u', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { child.kill(); await new Promise<void>(resolve => backend.close(() => resolve())); });
  const first = (await once(child.stdout!, 'data'))[0].toString(), brokerPort = Number(first.trim()); assert.ok(Number.isInteger(brokerPort));
  const socket = connect({ host: '127.0.0.1', port: brokerPort, allowHalfOpen: true }); socket.on('error', () => {}); await once(socket, 'connect');
  const chunks: Buffer[] = []; socket.on('data', chunk => chunks.push(chunk)); const ended = once(socket, 'end');
  socket.end(Buffer.concat([Buffer.from(token, 'hex'), bytes])); await ended; socket.destroy();
  const output = Buffer.concat(chunks); assert.equal(output.subarray(0, 8).toString(), 'SKRTOK01');
  assert.deepEqual(output.subarray(8), bytes); assert.deepEqual(received, bytes);
  const bad = connect(brokerPort, '127.0.0.1'); bad.on('error', () => {}); const closed = once(bad, 'close'); bad.end(Buffer.alloc(32)); await closed;
});

test('dedicated reverse scope preserves shared exports and persists full transport into its TTL watchdog request', async t => {
  const f = await fixture(t); await f.open(); const owner = proof(f), record = f.model.records.get(alpha)!;
  assert.equal(projectReverseTunnelScopePaths(f.configs.get(alpha)!).guest, '/run/sakura-reverse-tunnels/' + alpha);
  const scope = new ProjectReverseTunnelScope(f.machines, f.id, f.configs.get(alpha)!, 10);
  assert.equal(scope.expiresAt(), undefined);
  // Exercise the real helper serializer without running its privileged Python.
  const internals = scope as any, commands: string[] = [];
  const payload = { runId: record.runId, command: 'fixed-native-entry', input: f.model.frames[0], sha256: createHash('sha256').update(f.model.frames[0]).digest('hex') };
  internals.transport = async () => ({ version: 1, sha256: payload.sha256, bytes: payload.input.length });
  (f.machines as any).exec = async (_id: string, command: string) => { commands.push(command);
    return { code: 0, stdout: JSON.stringify({ status: 'running', bootId: owner.run.bootId, record }), stderr: '' }; };
  await internals.execute('commit', record); assert.ok(scope.expiresAt());
  const line = commands[0].split('\n').find(value => value.startsWith('# SAKURA_PROJECT_SERVICE_REQUEST='))!;
  const request = JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString());
  assert.equal(request.namespace, 'reverse-tunnel'); assert.deepEqual(request.transport, { version: 1, sha256: payload.sha256, bytes: payload.input.length });
  const source = commands[0].split('/usr/bin/python3 -I -S -c ')[1].slice(1, -1).replaceAll("'\\''", "'");
  assert.ok(source.includes("'transport'")); assert.ok(source.includes('clean_input')); assert.ok(source.includes('sakura-reverse-tunnels'));
  const embedded = (source: string) => JSON.parse(JSON.parse(source.split('\n')[1].slice('request=json.loads('.length, -1)));
  const watchdog = embedded(source).watchdogScript as string;
  assert.deepEqual(embedded(watchdog).transport, request.transport, 'standalone TTL stop must retain the complete clean_input transport');
  const python = spawnSync('python', ['--version'], { encoding: 'utf8' });
  if (python.status === 0) { const result = spawnSync('python', ['-I', '-S', '-c',
    'import sys,json;values=json.load(sys.stdin);[compile(value,"reverse-generated","exec") for value in values]'],
    { input: JSON.stringify([source, watchdog]), encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); }
});

test('real reverse service serializer and host journals preserve exact inherited native ownership and retry retirement', async t => {
  const id = randomUUID(), bootId = randomUUID(), live = {}, project = copy(projectSchema.parse({ directory: '/workspace/reverse-host-journal',
    networkIsolation: 'private', environment: { TOKEN: 'private-journal-token' } }), alpha);
  const records = new Map<string, ProjectReverseTunnelRecord>(), commands: string[] = []; let rootStopFailures = 0;
  const machines = { live: new Map([[id, live]]), get: () => ({ distro: 'debian' }), state: () => 'running',
    locked: async (_id: string, action: () => Promise<unknown>) => action(),
    exec: async (_id: string, command: string) => {
      commands.push(command); const line = command.split('\n').find(line => line.startsWith('# SAKURA_PROJECT_SERVICE_REQUEST='));
      if (!line) return { code: 0, stdout: '', stderr: '' };
      const request = JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()), original = request.record as ProjectReverseTunnelRecord;
      if (request.op === 'probe-reboot') return { code: 0, stdout: JSON.stringify({ bootId, retired: false }), stderr: '' };
      const prior = records.get(alpha);
      const reply = (record: ProjectReverseTunnelRecord | null) => ({ code: 0,
        stdout: JSON.stringify({ status: !record ? 'absent' : record.phase === 'running' ? 'running' : record.phase === 'stopped' ? 'stopped' : 'prepared', bootId, record }), stderr: '' });
      if (request.op === 'status') return reply(prior || null);
      if (request.op === 'stop' && rootStopFailures-- > 0) return { code: 73, stdout: '', stderr: 'original cgroup still populated' };
      const record: ProjectReverseTunnelRecord = request.op === 'prepare' ? { ...original, phase: 'prepared', inode: '700' } :
        request.op === 'start' ? { ...original, phase: 'prepared', sessionId: '$20', paneId: '%12', panePid: 123, paneStartTicks: '456' } :
          { ...original, phase: request.op === 'commit' ? 'running' : 'stopped' };
      records.set(alpha, record); return reply(record);
    },
  } as unknown as Machines;
  const { scopeIdentityFixture } = await import('./project-scope-identity-fixture.ts');
  const guest = scopeIdentityFixture(machines, project, () => bootId, runId => [...records.values()].find(record => record.runId === runId) || null);
  const scope = new ProjectReverseTunnelScope(machines, id, project, 10), native = new ProjectRunScopes(machines);
  const intent = scope.newIntent('d'.repeat(64), bootId); await scope.persistIntent(intent);
  const payload = await native.inherited(id, project, { command: reverseTunnelBrokerCommand(8765, 'b'.repeat(64), 10),
    environment: project.environment }, { kind: 'service', runId: intent.runId, bootId });
  const running = await scope.start(intent, payload, signal()); assert.equal((await scope.status(signal(), payload.sha256)).status, 'running');
  assert.equal(await native.active(id, alpha, intent.runId), true); assert.equal(await native.readonlyActive(id, alpha, intent.runId), true);
  const receipt = JSON.parse(await readFile(scope.receipt(), 'utf8')); assert.deepEqual(receipt, running);
  assert.equal(guest.tickets.get(intent.runId)!.cgroupName, intent.scopeName);
  const commit = commands.find(command => command.includes('# SAKURA_PROJECT_SERVICE_COMMIT'))!;
  const source = commit.split('/usr/bin/python3 -I -S -c ')[1].slice(1, -1).replaceAll("'\\''", "'");
  const embedded = (source: string) => JSON.parse(JSON.parse(source.split('\n')[1].slice('request=json.loads('.length, -1)));
  assert.deepEqual(embedded(embedded(source).watchdogScript).transport, { version: 1, sha256: payload.sha256, bytes: payload.input.length });
  rootStopFailures = 3; await assert.rejects(scope.stop(running), (error: any) => error.status === 503);
  assert.equal(guest.tickets.get(intent.runId)!.phase, 'active'); assert.deepEqual(JSON.parse(await readFile(scope.receipt(), 'utf8')), running);
  rootStopFailures = 0; await scope.stop(running); assert.equal(guest.tickets.get(intent.runId)!.phase, 'closed');
  assert.equal((await scope.metadata())!.phase, 'stopped'); assert.equal(await native.readonlyActive(id, alpha, intent.runId), false);
  const owned = await realpath(vmDir(id)); assert.equal(dirname(owned), await realpath(VM_ROOT));
  assert.equal(owned.split(/[\\/]/).at(-1), id); await rm(owned, { recursive: true, force: true });
});
