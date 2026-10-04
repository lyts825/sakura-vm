import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Features } from '../server/features.ts';
import type { Machines } from '../server/machines.ts';
import type { PluginContext } from '../server/plugin-api.ts';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { ServiceBroker } from '../server/service-broker.ts';
import { serviceRef } from '../server/service-ref.ts';
import { definePlugin, pin } from '../shared/plugin-protocol.ts';
import { HostRuntime, resourceContext } from '../server/host-runtime/index.ts';
import { pluginAuthority } from '../server/plugin-authority.ts';
import { PluginScope } from '../server/plugin-scope.ts';
import { AppError } from '../shared/errors.ts';

const provider = definePlugin({ id: 'provider', name: 'Provider', description: 'test',
  category: 'operations', services: ['example'] });
const consumer = definePlugin({ id: 'consumer', name: 'Consumer', description: 'test',
  category: 'operations', requires: [pin('provider')] });
const example = serviceRef<{ value: number; call(): number }>('provider', 'example');
function checkTypes(context: PluginContext) {
  const value: number = context.use(example).value;
  // @ts-expect-error the reference requires a numeric value
  context.provide(example, { value: 'wrong' });
  return value;
}
void checkTypes;
function fixture(optional = false) {
  const directory = new PluginDirectory(), catalog = [provider, optional ? { ...consumer, requires: [], optional: [pin('provider')] } : consumer];
  const owner = directory.begin('official', 'provider', provider.version, 'a'.repeat(64));
  const client = directory.begin('official', 'consumer', consumer.version, 'b'.repeat(64));
  directory.publish(client);
  const broker = new ServiceBroker(directory, catalog);
  return { directory, owner, client, broker, manifest: catalog[1] };
}

test('typed service handles enforce ownership, dependencies and versions on every call', async () => {
  const { directory, owner, client, broker, manifest } = fixture();
  try {
    assert.equal(broker.lookup(client, manifest, example, true), undefined);
    const raw = { value: 42, call: () => 42 };
    assert.equal(broker.register(owner, example, raw), raw);
    assert.throws(() => broker.lookup(client, manifest, example), { code: 'PLUGIN_SERVICE_UNAVAILABLE' });
    directory.publish(owner);
    const handle = broker.lookup(client, manifest, example)!;
    assert.notEqual(handle, raw); assert.equal(handle.value, 42); assert.equal(handle.call(), 42);
    assert.throws(() => broker.register(owner, example, raw), /已注册/);
    assert.throws(() => broker.register(client, example, raw), /其他提供者/);
    assert.throws(() => broker.lookup(client, { ...manifest, requires: [] }, example), /未声明依赖/);
    assert.throws(() => broker.lookup(client, manifest, serviceRef('provider', 'undeclared')), /未声明服务/);
    assert.throws(() => broker.lookup(client, manifest, serviceRef('provider', 'example', 2)), { code: 'PLUGIN_SERVICE_VERSION' });
    const cached = handle.call;
    owner.revoke();
    assert.throws(cached, { code: 'PLUGIN_REVOKED' });
    await owner.scope.dispose(); owner.phase = 'inactive';
    broker.remove(owner);
    const successor = directory.begin('official', 'provider', provider.version, 'c'.repeat(64));
    broker.register(successor, example, { value: 7, call: () => 7 }); directory.publish(successor);
    assert.throws(cached, { code: 'PLUGIN_REVOKED' });
    assert.equal(broker.lookup(client, manifest, example)!.call(), 7);
    await successor.scope.dispose();
  } finally { await owner.scope.dispose(); await client.scope.dispose(); }
});

test('revocation rechecks queued work and keeps provider ownership and caller identity', async () => {
  const { directory, owner, client, broker, manifest } = fixture();
  const runtime = new HostRuntime({ budgets: { work: { capacity: 1 } } });
  const block = await runtime.acquire({ owner: 'block', kind: 'test', label: 'block', cost: { work: 1 } });
  const ref = serviceRef<{ run(): Promise<void> }>('provider', 'example');
  let invoked = false;
  broker.register(owner, ref, { async run() {
    assert.equal(resourceContext()?.pluginGeneration, owner.generation);
    assert.equal(resourceContext()?.callerPluginGeneration, client.generation);
    const lease = await runtime.acquire({ owner: owner.owner, kind: 'test', label: 'queued', cost: { work: 1 } });
    try { invoked = true; } finally { lease.release(); }
  } });
  directory.publish(owner);
  const pending = broker.lookup(client, manifest, ref)!.run();
  const rejected = assert.rejects(pending, { code: 'PLUGIN_PERMISSION_DENIED' });
  client.setPermissions(['vm']);
  block.release(); await rejected;
  assert.equal(invoked, false);
  await owner.scope.dispose(); await client.scope.dispose(); runtime.close();
});

test('optional discovery does not pin an idle provider and retained nested handles revoke', async () => {
  const { directory, owner, client, broker, manifest } = fixture(true);
  const ref = serviceRef<{ nested: { ping(): number } }>('provider', 'example');
  broker.register(owner, ref, { nested: { ping: () => 1 } }); directory.publish(owner);
  const nested = broker.lookup(client, manifest, ref)!.nested;
  assert.equal(broker.activeBorrows(owner), 0); assert.equal(nested.ping(), 1);
  owner.revoke(); assert.throws(() => nested.ping(), { code: 'PLUGIN_REVOKED' });
  assert.equal(broker.lookup(client, manifest, ref, true), undefined);
  await owner.scope.dispose(); await client.scope.dispose();
});

test('cached returned async callables retain both scopes until their original invocation finishes', async () => {
  const { directory, owner, client, broker, manifest } = fixture();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const ref = serviceRef<{ callable(): (callback: () => string | undefined) => Promise<void> }>('provider', 'example');
  broker.register(owner, ref, { callable: () => async (callback) => {
    assert.equal(pluginAuthority(), owner);
    assert.equal(resourceContext()?.callerPluginGeneration, client.generation);
    assert.equal(callback(), client.generation);
    await blocked;
  } });
  directory.publish(owner);
  const callable = broker.lookup(client, manifest, ref)!.callable();
  const pending = callable(() => pluginAuthority()?.generation);
  assert.equal(broker.activeBorrows(owner), 1);
  assert.equal(owner.scope.diagnostics().active, 1);
  assert.equal(client.scope.diagnostics().active, 1);
  let ownerDisposed = false, clientDisposed = false;
  owner.revoke(); client.revoke();
  const ownerClosing = owner.scope.dispose().then(() => { ownerDisposed = true; });
  const clientClosing = client.scope.dispose().then(() => { clientDisposed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ownerDisposed, false); assert.equal(clientDisposed, false);
  assert.throws(() => callable(() => undefined), { code: 'PLUGIN_REVOKED' });
  release();
  await Promise.all([pending, ownerClosing, clientClosing]);
  assert.equal(broker.activeBorrows(owner), 0);
});

test('nested calls through returned callables preserve the original caller and callback authority', async () => {
  const directory = new PluginDirectory();
  const middleManifest = { ...consumer, services: ['example'] };
  const originalManifest = definePlugin({ id: 'original', name: 'Original', description: 'test',
    category: 'operations', requires: [pin('consumer')] });
  const owner = directory.begin('official', 'provider', provider.version, 'a'.repeat(64));
  const middle = directory.begin('official', 'consumer', consumer.version, 'b'.repeat(64));
  const original = directory.begin('official', 'original', originalManifest.version, 'c'.repeat(64));
  const broker = new ServiceBroker(directory, [provider, middleManifest, originalManifest]);
  const ref = serviceRef<{ callable(): (callback: () => void) => void }>('provider', 'example');
  broker.register(owner, ref, { callable: () => (callback) => {
    assert.equal(pluginAuthority(), owner);
    assert.equal(resourceContext()?.callerPluginGeneration, original.generation);
    callback();
  } });
  directory.publish(owner);
  const callable = broker.lookup(middle, middleManifest, ref)!.callable();
  const middleRef = serviceRef<{ run(callback: () => void): void }>('consumer', 'example');
  broker.register(middle, middleRef, { run: (callback) => callable(callback) });
  directory.publish(middle); directory.publish(original);
  let called = false;
  broker.lookup(original, originalManifest, middleRef)!.run(() => {
    called = true;
    assert.equal(pluginAuthority(), original);
    assert.equal(resourceContext()?.callerPluginGeneration, original.generation);
  });
  assert.equal(called, true);
  await Promise.all([owner.scope.dispose(), middle.scope.dispose(), original.scope.dispose()]);
});

test('observed and scoped cleanup failures retain one original recovery while ordinary cancellation does not', async () => {
  const scope = new PluginScope();
  const error = new AppError('original physical cleanup unconfirmed', 503, 'TEST_CLEANUP_UNCONFIRMED');
  const observed = Promise.reject(error);
  scope.observe(observed);
  await assert.rejects(observed, (failure) => failure === error);
  assert.equal(scope.diagnostics().cleanup.length, 1);
  const pending = scope.run(async () => { throw error; });
  scope.observe(pending);
  await assert.rejects(pending, (failure) => failure === error);
  const repeated = Promise.reject(error);
  scope.observe(repeated);
  await assert.rejects(repeated, (failure) => failure === error);
  const cancelled = Promise.reject(new DOMException('cancelled', 'AbortError'));
  scope.observe(cancelled);
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(scope.diagnostics().cleanup.length, 1);
  let cleanupConfirmed = false;
  scope.retainCleanup(async () => { if (!cleanupConfirmed) throw error; });
  await assert.rejects(scope.dispose(), (failure) =>
    failure instanceof AggregateError && failure.errors.length === 1 && failure.errors[0] === error);
  const [{ id }] = scope.diagnostics().cleanup;
  let recovered = 0;
  await scope.recoverCleanup(id, async () => { ++recovered; cleanupConfirmed = true; });
  await scope.dispose();
  assert.equal(recovered, 1);
});

test('contexts are immutable independent objects with no writable service slots', async () => {
  const host = await Features.create(new EventEmitter() as Machines);
  assert.deepEqual(host.pluginResources(), []);
  await host.close();
});
