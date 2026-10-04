type GatewayFixtureHost = import('../server/features.ts').Features;
type GatewayFixtureBody = Parameters<GatewayFixtureHost['route']>[3];
const admittedRouteFixtures = new WeakMap<GatewayFixtureHost, {
  gateway: import('../server/operation-gateway.ts').OperationGateway;
  bodies: WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>;
}>();
/** Preserve the fixture's data-directory setup before loading the real operation admission modules. */
async function routeThroughGateway(host: GatewayFixtureHost, req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse, url: URL, body: GatewayFixtureBody) {
  let fixture = admittedRouteFixtures.get(host);
  if (!fixture) {
    const [{ OperationGateway }, { operationEntries }] = await Promise.all([
      import('../server/operation-gateway.ts'), import('../server/operation-catalog.ts'),
    ]);
    const bodies = new WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>();
    const gateway = new OperationGateway({
      enabled: () => host.enabled,
      instance: owner => owner === 'core' ? undefined : host.directory.get('official', owner),
      bind: async (_request, _url, _entry, _parameters, requireEnabled) => {
        requireEnabled();
        return { check: async () => 'owner' };
      },
    });
    for (const entry of operationEntries)
      if (entry.declaration.method !== 'UPGRADE')
        gateway.register(entry, (request, response, target) => host.route(request, response, target, bodies.get(request)!));
    gateway.seal();
    fixture = { gateway, bodies };
    admittedRouteFixtures.set(host, fixture);
  }
  fixture.bodies.set(req, body);
  return await fixture.gateway.dispatch(req, res, url) as boolean;
}
import { services as metricsContract } from '../plugins/metrics/services.ts';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { AppError } from '../shared/errors.ts';
import { Features } from '../server/features.ts';
import { hostRuntime, resourceContext } from '../server/host-runtime/index.ts';
import type { Machines } from '../server/machines.ts';
import { NetworkRuntime, NetworkScope, networkDefaults } from '../server/network/index.ts';
import { pluginCapabilities } from '../server/plugin-capabilities.ts';
import type { PluginContext } from '../server/plugin-api.ts';
import { PluginScope, withinDeadline } from '../server/plugin-scope.ts';
import { loaders } from '../server/plugins/registry.ts';

const turn = () => new Promise<void>((done) => setImmediate(done));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const machines = () => Object.assign(new EventEmitter(), { records: new Map(), live: new Map(), get: () => ({}) }) as unknown as Machines;
async function eventually(check: () => boolean) {
  for (let tries = 0; tries < 100; tries++) { if (check()) return; await new Promise((done) => setTimeout(done, 5)); }
  assert.ok(check(), 'operation did not reach the expected state');
}

test('plugin jobs bind owner, revoke queued admission and wait for running cleanup', async () => {
  const scope = new PluginScope('plugin:test-jobs'), capability = pluginCapabilities('test-jobs', machines(), scope);
  const jobs = capability.jobs.create('tasks', { persistent: false });
  const blocker = await hostRuntime.acquire({ owner: 'test:block', kind: 'test', label: 'hold jobs', cost: { jobs: 14 } });
  let calls = 0;
  const queued = jobs.start('queued', async () => { calls++; }, { owner: 'spoofed-owner' });
  assert.equal(queued.owner, 'plugin:test-jobs');
  await eventually(() => hostRuntime.snapshot().resources.some((row) => row.owner === 'plugin:test-jobs' && row.state === 'queued'));
  scope.abort();
  await jobs.wait('queued');
  blocker.release();
  assert.equal(calls, 0);
  assert.equal(queued.status, 'cancelled');
  assert.throws(() => jobs.start('late', async () => {}));
  await scope.dispose();

  const runningScope = new PluginScope('plugin:test-running'), running = pluginCapabilities('test-running', machines(), runningScope);
  const store = running.jobs.create('running', { persistent: false }), started = deferred(), cleanup = deferred();
  let signal!: AbortSignal;
  store.start('active', async (_log, current) => {
    signal = current;
    assert.equal(resourceContext()?.pluginId, 'test-running');
    started.resolve(); await cleanup.promise;
  });
  await started.promise;
  let closed = false; const closing = runningScope.dispose().then(() => { closed = true; });
  await turn(); assert.equal(signal.aborted, true); assert.equal(closed, false);
  cleanup.resolve(); await closing;
});

test('plugin storage cancels while queued and binds owner while holding real cleanup', async () => {
  const scope = new PluginScope('plugin:test-storage'), capability = pluginCapabilities('test-storage', machines(), scope);
  const blocker = await hostRuntime.acquire({ owner: 'test:block', kind: 'test', label: 'hold IO', cost: { io: 6 } });
  let ran = false;
  const request = { label: 'plugin read', paths: [process.cwd()], mode: 'read' as const, buffers: 1024, files: 1 };
  const pending = capability.storage.run(request, async () => { ran = true; });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await eventually(() => hostRuntime.snapshot().resources.some((row) => row.owner === 'plugin:test-storage' && row.state === 'queued'));
  scope.abort(); await rejected; blocker.release(); await scope.dispose(); assert.equal(ran, false);

  const live = new PluginScope('plugin:test-storage-live'), cap = pluginCapabilities('test-storage-live', machines(), live);
  const started = deferred(), cleanup = deferred(); let signal!: AbortSignal;
  const active = cap.storage.run(request, async (lease, current) => {
    signal = current;
    const record = hostRuntime.snapshot().resources.find((row) => row.id === lease.id)!;
    assert.equal(record.owner, 'plugin:test-storage-live'); assert.equal(record.identity.pluginId, 'test-storage-live');
    started.resolve(); await cleanup.promise;
  });
  const cancelled = assert.rejects(active, { name: 'AbortError' });
  await started.promise; let finished = false;
  const closing = live.dispose().then(() => { finished = true; });
  await turn(); assert.equal(signal.aborted, true); assert.equal(finished, false);
  cleanup.resolve(); await cancelled; await closing;
});

test('plugin execution cancels queued admission and captures plugin/VM identity', async () => {
  const vmId = randomUUID(), m = machines(); m.live.set(vmId, {} as never);
  const scope = new PluginScope('plugin:test-execution'), cap = pluginCapabilities('test-execution', m, scope);
  const blocker = await hostRuntime.acquire({ owner: 'test:block', kind: 'test', label: 'hold execution', cost: { execution: 14 } });
  let ran = false;
  const pending = cap.execution.run({ vmId, projectId: 'default', signal: new AbortController().signal }, async () => { ran = true; });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await eventually(() => hostRuntime.snapshot().resources.some((row) => row.owner === 'plugin:test-execution' && row.state === 'queued'));
  scope.abort(); await rejected; blocker.release(); await scope.dispose(); assert.equal(ran, false);
  const live = new PluginScope('plugin:test-execution-live'), active = pluginCapabilities('test-execution-live', m, live);
  await active.execution.run({ vmId, projectId: 'default', signal: new AbortController().signal }, async (execution) => {
    assert.equal(execution.identity.vmId, vmId);
    assert.equal(execution.owner, 'plugin:test-execution-live');
    assert.equal(resourceContext()?.pluginId, 'test-execution-live');
  });
  await live.dispose();
});

test('scope cleanup timeout keeps the original disposer, and domain cleanup receipts require explicit recovery', async () => {
  const scope = new PluginScope('plugin:cleanup'), cleanup = deferred(); let calls = 0;
  scope.add(async () => { calls++; await cleanup.promise; });
  await assert.rejects(withinDeadline(scope.dispose(), 10, 'cleanup'), /超过/);
  let done = false; const retry = scope.dispose().then(() => { done = true; });
  await turn(); assert.equal(done, false); assert.equal(calls, 1);
  cleanup.resolve(); await retry;

  const failed = new PluginScope('plugin:cleanup-failure');
  await assert.rejects(failed.run(async () => { throw new AppError('owned handle still open', 503, 'STORAGE_CLEANUP_PENDING'); }));
  await assert.rejects(failed.dispose(), AggregateError);
  const receipt = failed.diagnostics().cleanup[0]; assert.ok(receipt.id);
  await assert.rejects(failed.recoverCleanup('another-plugin', async () => {}), { code: 'PLUGIN_CLEANUP_UNKNOWN' });
  await assert.rejects(failed.recoverCleanup(receipt.id, async () => { throw new Error('still open'); }));
  await assert.rejects(failed.dispose());
  await failed.recoverCleanup(receipt.id, async () => {}); await failed.dispose();
});

test('unload aborts active requests, blocks capabilities and retains failed service cleanup for retry', async () => {
  const original = loaders.metrics, started = deferred(), cleanup = deferred(); let context!: PluginContext, closeCalls = 0;
  loaders.metrics = async () => ({ ...(await original()), activate: async (host) => {
    context = host;
    host.provide(metricsContract.metrics, { sample: async () => ({}), forget: () => {}, close: async () => { if (++closeCalls === 1) throw new Error('retry cleanup'); } } as any);
  }, operations: { sample: { response: (await original()).operations!.sample.response,
    async execute(_url, _input, signal) { started.resolve(); await cleanup.promise; signal.throwIfAborted(); return {}; } } } });
  let host: Features | undefined;
  try {
    host = await Features.create(machines(), ['metrics']); assert.deepEqual(host.errors, {});
    const req = Object.assign(new EventEmitter(), { method: 'GET', headers: {} }) as IncomingMessage;
    const res = Object.assign(new EventEmitter(), { writableFinished: false }) as ServerResponse;
    const active = routeThroughGateway(host, req, res, new URL('http://localhost/api/vms/example/metrics'), async () => undefined);
    const cancelled = assert.rejects(active, { name: 'AbortError' }); await started.promise;
    const unloading = host.unload('metrics'); const failure = assert.rejects(unloading, /插件资源清理失败/);
    assert.equal(context.signal.aborted, true); assert.equal(host.enabled.has('metrics'), false);
    assert.throws(() => context.capabilities.jobs.create('late'));
    await assert.rejects(routeThroughGateway(host, req, res, new URL('http://localhost/api/vms/example/metrics'), async () => undefined));
    assert.equal(closeCalls, 0); cleanup.resolve(); await cancelled; await failure;
    assert.ok(host.serviceValue('metrics')); assert.equal(host.pluginResources()[0].cleanupPending, true);
    await host.unload('metrics'); assert.equal(closeCalls, 2); assert.equal(host.serviceValue('metrics'), undefined);
    assert.deepEqual(host.pluginResources(), []);
  } finally { cleanup.resolve(); await host?.close(); loaders.metrics = original; }
});

test('network scope waits for original handle closure and does not await a sibling with the same owner', async () => {
  const runtime = new NetworkRuntime(networkDefaults()), first = new NetworkScope({ owner: 'plugin:network-test', purpose: 'test' }, runtime),
    second = new NetworkScope({ owner: 'plugin:network-test', purpose: 'test' }, runtime);
  const server = first.createServer(), sibling = second.createServer();
  server.listen(0, '127.0.0.1'); sibling.listen(0, '127.0.0.1');
  await Promise.all([once(server, 'listening'), once(sibling, 'listening')]);
  let closed = false; server.once('close', () => { closed = true; });
  try {
    await first.close(); assert.equal(closed, true); assert.equal(sibling.listening, true);
    assert.equal(runtime.snapshot().leases.filter((lease) => lease.scopeId === first.identity.scopeId).length, 0);
  } finally { await second.close(); await runtime.close(); }
});

test('plugin scope bounds synchronous registration before asynchronous resource admission', async () => {
  const scope = new PluginScope('plugin:bounded'), gate = deferred();
  const waiting = Array.from({ length: 128 }, () => scope.run(() => gate.promise));
  assert.throws(() => scope.run(() => gate.promise), { code: 'PLUGIN_QUEUE_FULL' });
  await turn(); gate.resolve(); await Promise.all(waiting); await scope.dispose();
});

test('failed network disposal remains registered and can be retried', async () => {
  const runtime = new NetworkRuntime(networkDefaults()), scope = new NetworkScope({ owner: 'plugin:network-retry', purpose: 'test' }, runtime);
  let calls = 0;
  (scope as any).fetchAgent = { destroy: async () => { if (++calls === 1) throw new Error('destroy not confirmed'); } };
  await assert.rejects(scope.close(), /not confirmed/);
  await runtime.close(); assert.equal(calls, 2);
});

test('plugin job retry cannot bypass unresolved cleanup with a forged view', async () => {
  const original = loaders.metrics; let context!: PluginContext;
  let jobs!: ReturnType<PluginContext['capabilities']['jobs']['create']>, retried = 0;
  loaders.metrics = async () => ({ ...(await original()), activate: async (host) => {
    context = host; jobs = host.capabilities.jobs.create('retry', { persistent: false });
    host.provide(metricsContract.metrics, { sample: async () => ({}), forget: () => {}, jobs } as any); host.registerJobs(jobs, () => { retried++; });
  } });
  let host: Features | undefined;
  try {
    host = await Features.create(machines(), ['metrics']); assert.deepEqual(host.errors, {});
    const view = jobs.start('failed-cleanup', async () => {
      throw new AppError('cleanup required', 503, 'STORAGE_CLEANUP_PENDING');
    });
    await jobs.wait('failed-cleanup');
    assert.equal(view.admission, 'cleanup-pending');
    const retry = host.retryHandler(jobs)!;
    assert.throws(() => retry({ ...view, admission: 'running', cleanupResolvedAt: new Date().toISOString() }),
      { code: 'PLUGIN_CLEANUP_PENDING' });
    assert.equal(retried, 0);
    await jobs.resolveCleanup(view.id!); await retry(view); assert.equal(retried, 1);
    await host.unload('metrics'); assert.equal(context.signal.aborted, true);
    assert.throws(() => retry(view));
  } finally { await host?.close(); loaders.metrics = original; }
});
