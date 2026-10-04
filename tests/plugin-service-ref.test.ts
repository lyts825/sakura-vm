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

test('contexts are immutable independent objects with no writable service slots', async () => {
  const host = await Features.create(new EventEmitter() as Machines);
  assert.deepEqual(host.pluginResources(), []);
  await host.close();
});

