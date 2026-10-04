import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { ServiceBroker } from '../server/service-broker.ts';
import { Workspaces } from '../server/workspaces.ts';
import { serviceRef } from '../server/service-ref.ts';
import { serviceContracts } from '../server/service-contracts.ts';
import { definePlugin, pin } from '../shared/plugin-protocol.ts';
import { pluginAuthority, pluginCleanup, withPluginAuthority } from '../server/plugin-authority.ts';
import { MetadataStore } from '../server/metadata-store.ts';
import { pluginSurfaceEnabled } from '../shared/plugins.ts';
import { vmAccess } from '../server/vm-access.ts';
import { registerVmBootProvider, vmBootProviders } from '../server/vm-lifetime.ts';
import { cleanupReceipt } from '../server/cleanup-receipt.ts';
import { resourceContext } from '../server/host-runtime/context.ts';
import { AppError } from '../shared/errors.ts';

test('public service descriptors deny implementation fields and consumer lifecycle while unregister receipts survive revocation', async () => {
  const directory = new PluginDirectory();
  const provider = definePlugin({
    id: 'provider',
    name: 'p',
    description: 'test',
    category: 'operations',
    services: ['workspace'],
  });
  const client = definePlugin({
    id: 'client',
    name: 'c',
    description: 'test',
    category: 'operations',
    requires: [pin('provider')],
  });
  const owner = directory.begin('official', provider.id, provider.version, 'a'.repeat(64));
  const consumer = directory.begin('official', client.id, client.version, 'b'.repeat(64));
  const broker = new ServiceBroker(directory, [provider, client]);
  const vm = Object.assign(new EventEmitter(), { records: new Map(), live: new Map() });
  const raw = new Workspaces(vm as never, undefined, { background: false });
  const ref = serviceRef('provider', 'workspace', serviceContracts.Workspaces);
  broker.register(owner, ref, raw);
  directory.publish(owner);
  directory.publish(consumer);
  const borrowed = broker.lookup(consumer, client, ref)!;
  assert.throws(() => Reflect.get(borrowed, 'configListeners'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  assert.throws(() => Reflect.get(borrowed, 'machines'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  assert.throws(() => Reflect.get(borrowed, 'close'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  assert.throws(() => Reflect.get(borrowed.projects, 'context'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  const unregister = borrowed.beforeConfigChange(async () => {});
  consumer.revoke();
  unregister();
  unregister();
  await consumer.scope.dispose();
  await raw.close();
  await owner.scope.dispose();
});

test('queued metadata rechecks the originating generation before editing or publishing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-plugin-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = new PluginDirectory(),
    instance = directory.begin('official', 'metadata', '1', 'a'.repeat(64));
  directory.publish(instance);
  const store = new MetadataStore(join(root, 'metadata.json'), { fallback: () => ({ value: 0 }) });
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = store.update(async () => {
    entered();
    await blocked;
  });
  await ready;
  const queued = withPluginAuthority(instance, () => store.replace({ value: 1 }));
  const rejected = assert.rejects(queued, { code: 'PLUGIN_REVOKED' });
  instance.revoke();
  release();
  await first;
  await rejected;
  assert.equal((await store.read()).value.value, 0);
  await instance.scope.dispose();
});

test('the UI consumes only contributions published for a running generation', async () => {
  const directory = new PluginDirectory(),
    instance = directory.begin('official', 'metrics', '1', 'a'.repeat(64));
  instance.contribute('tab', 'metrics');
  assert.equal(pluginSurfaceEnabled(['metrics'], 'tabs', 'metrics', directory.view()), false);
  directory.publish(instance);
  assert.equal(pluginSurfaceEnabled(['metrics'], 'tabs', 'metrics', directory.view()), true);
  instance.revoke();
  assert.equal(pluginSurfaceEnabled(['metrics'], 'tabs', 'metrics', directory.view()), false);
  assert.equal(pluginSurfaceEnabled([], 'tabs', 'terminal', directory.view()), true);
  await instance.scope.dispose();
});

test('broker data responses preserve null-prototype GraphQL records', async () => {
  const directory = new PluginDirectory();
  const manifest = definePlugin({
    id: 'data',
    name: 'data',
    description: 'test',
    category: 'operations',
    services: ['query'],
  });
  const instance = directory.begin('official', 'data', manifest.version, 'a'.repeat(64));
  const broker = new ServiceBroker(directory, [manifest]);
  const value = { query: () => ({ data: Object.assign(Object.create(null), { vms: [] }) }) };
  const ref = serviceRef<typeof value>('data', 'query', { id: 'test.query.v1', version: 1, members: ['query'] });
  broker.register(instance, ref, value);
  directory.publish(instance);
  assert.equal(JSON.stringify(broker.lookup(instance, manifest, ref)!.query()), '{"data":{"vms":[]}}');
  await instance.scope.dispose();
});

test('failed async unregister receipts can retry after the consumer and provider are revoked', async () => {
  const directory = new PluginDirectory();
  const provider = definePlugin({
    id: 'receipt',
    name: 'receipt',
    description: 'test',
    category: 'operations',
    services: ['api'],
  });
  const client = definePlugin({
    id: 'client',
    name: 'client',
    description: 'test',
    category: 'operations',
    requires: [pin('receipt')],
  });
  const owner = directory.begin('official', provider.id, provider.version, 'a'.repeat(64));
  const consumer = directory.begin('official', client.id, client.version, 'b'.repeat(64));
  const broker = new ServiceBroker(directory, [provider, client]);
  let attempts = 0;
  const api = {
    subscribe: () =>
      cleanupReceipt(async () => {
        if (++attempts < 3) throw new Error('original cleanup not confirmed');
      }),
  };
  const ref = serviceRef<typeof api>('receipt', 'api', { id: 'test.receipt.v1', version: 1, members: ['subscribe'] });
  broker.register(owner, ref, api);
  directory.publish(owner);
  directory.publish(consumer);
  const unregister = broker.lookup(consumer, client, ref)!.subscribe();
  await assert.rejects(unregister(), /not confirmed/);
  owner.revoke();
  consumer.revoke();
  await new Promise((resolve) => setImmediate(resolve));
  await consumer.scope.dispose();
  await unregister();
  assert.equal(attempts, 3);
  await owner.scope.dispose();
});

test('promised cleanup receipts arriving after revocation retain original cleanup and recover both scopes', async () => {
  const directory = new PluginDirectory();
  const provider = definePlugin({ id: 'receipt', name: 'receipt', description: 'test',
    category: 'operations', services: ['api'] });
  const client = definePlugin({ id: 'client', name: 'client', description: 'test',
    category: 'operations', requires: [pin('receipt')] });
  const owner = directory.begin('official', provider.id, provider.version, 'a'.repeat(64));
  const consumer = directory.begin('official', client.id, client.version, 'b'.repeat(64));
  const broker = new ServiceBroker(directory, [provider, client]);
  let releaseReceipt!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseReceipt = resolve; });
  let confirmed = false, attempts = 0;
  const failure = new AppError('original cleanup not confirmed', 503, 'TEST_CLEANUP_UNCONFIRMED');
  const api = { subscribe: async () => {
    await blocked;
    return cleanupReceipt(async () => {
      ++attempts;
      assert.equal(pluginAuthority(), owner);
      assert.equal(pluginCleanup(), owner);
      assert.equal(resourceContext()?.pluginGeneration, owner.generation);
      if (!confirmed) throw failure;
    });
  } };
  const ref = serviceRef<typeof api>('receipt', 'api', { id: 'test.receipt.v1', version: 1, members: ['subscribe'] });
  broker.register(owner, ref, api);
  directory.publish(owner); directory.publish(consumer);
  const subscribing = broker.lookup(consumer, client, ref)!.subscribe();
  owner.revoke(); consumer.revoke();
  const ownerClosing = assert.rejects(owner.scope.dispose(), AggregateError);
  const consumerClosing = assert.rejects(consumer.scope.dispose(), AggregateError);
  releaseReceipt();
  const unregister = await subscribing;
  await Promise.all([ownerClosing, consumerClosing]);
  assert.ok(attempts > 0);
  assert.equal(owner.scope.diagnostics().cleanup.length, 1);
  assert.equal(consumer.scope.diagnostics().cleanup.length, 1);
  await assert.rejects(unregister(), (error) => error === failure);
  confirmed = true;
  await Promise.all([unregister(), unregister()]);
  assert.equal(owner.scope.diagnostics().cleanup.length, 0);
  assert.equal(consumer.scope.diagnostics().cleanup.length, 0);
  await Promise.all([owner.scope.dispose(), consumer.scope.dispose()]);
  const completedAttempts = attempts;
  owner.phase = 'inactive'; broker.remove(owner);
  const successor = directory.begin('official', provider.id, provider.version, 'c'.repeat(64));
  broker.register(successor, ref, { subscribe: async () => cleanupReceipt(async () => {
    throw new Error('old receipt called the new generation');
  }) });
  directory.publish(successor);
  await unregister();
  assert.equal(attempts, completedAttempts);
  await successor.scope.dispose();
});

test('boot providers registered through VM ports retain host identity, generation and cleanup receipts', async () => {
  const directory = new PluginDirectory(),
    instance = directory.begin('system', 'boot', '1', 'a'.repeat(64));
  const host = Object.assign(new EventEmitter(), { live: new Map() });
  const port = vmAccess(host as never, instance.scope, instance);
  let closed = 0;
  withPluginAuthority(instance, () =>
    registerVmBootProvider(port, 'fixture', {
      prepare: async () => {
        assert.equal(resourceContext()?.pluginGeneration, instance.generation);
        return {
          args: [],
          close: async () => {
            ++closed;
          },
        };
      },
    }),
  );
  directory.publish(instance);
  const provider = vmBootProviders(host)[0][1];
  const attachment = await provider.prepare({} as never, () => {});
  instance.revoke();
  assert.throws(() => provider.prepare({} as never, () => {}), { code: 'PLUGIN_REVOKED' });
  await attachment!.close();
  assert.equal(closed, 1);
  await instance.scope.dispose();
  assert.deepEqual(vmBootProviders(host), []);
});

test('cached VM transports check permissions and original VM identity while retaining their own close handle', async () => {
  const directory = new PluginDirectory(),
    instance = directory.begin('official', 'transport', '1', 'a'.repeat(64));
  const raw = Object.assign(new EventEmitter(), {
    exec: () => {
      ++commands;
    },
    destroy: () => {
      ++closed;
    },
    _sock: {},
  });
  let commands = 0,
    closed = 0;
  const host = Object.assign(new EventEmitter(), { live: new Map([['vm', {}]]), connect: async () => raw });
  const port = vmAccess(host as never, instance.scope, instance);
  directory.publish(instance);
  const client = await port.connect('vm');
  const exec = client.exec;
  exec('true', () => {});
  assert.equal(commands, 1);
  assert.throws(() => Reflect.get(client, '_sock'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  instance.setPermissions(['vm']);
  assert.throws(() => exec('true', () => {}), { code: 'PLUGIN_PERMISSION_DENIED' });
  instance.setPermissions(['vm', 'execution']);
  host.live.set('vm', {});
  assert.throws(() => exec('true', () => {}), { code: 'PLUGIN_VM_IDENTITY' });
  instance.revoke();
  client.destroy();
  assert.equal(closed, 1);
  assert.throws(() => exec('true', () => {}));
  await instance.scope.dispose();
});
