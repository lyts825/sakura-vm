import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Features } from '../server/features.ts';
import type { Machines } from '../server/machines.ts';
import { pluginContext, type PluginContext } from '../server/plugin-api.ts';
import { PluginScope } from '../server/plugin-scope.ts';
import { serviceRef } from '../server/service-ref.ts';
import { definePlugin, pin } from '../shared/plugin-protocol.ts';

const provider = definePlugin({
  id: 'provider',
  name: 'Provider',
  description: 'test',
  category: 'operations',
  services: ['example'],
});
const consumer = definePlugin({
  id: 'consumer',
  name: 'Consumer',
  description: 'test',
  category: 'operations',
  requires: [pin('provider')],
});
const example = serviceRef<{ value: number }>('provider', 'example');

// Compile-time coverage: callers infer the service, and providers cannot change its shape.
function checkTypes(context: PluginContext) {
  const value: number = context.use(example).value;
  // @ts-expect-error the reference requires a numeric value
  context.provide(example, { value: 'wrong' });
  return value;
}
void checkTypes;

test('typed services use the common store and enforce ownership and direct dependencies', async () => {
  const host = await Features.create(new EventEmitter() as Machines);
  const scope = new PluginScope();
  const catalog = [provider, consumer];
  const owner = pluginContext(host, provider, catalog, scope);
  const client = pluginContext(host, consumer, catalog, scope);
  const service = { value: 42 };
  assert.equal(client.optional(example), undefined);
  assert.equal(owner.provide(example, service), service);
  assert.equal(host.serviceValue('example'), service);
  assert.throws(() => client.use(example), /插件/);
  host.enabled.add('provider');
  assert.equal(client.use(example), service);
  assert.equal(client.optional(example), service);
  assert.throws(() => owner.provide(example, service), /已注册/);
  assert.throws(() => client.provide(example, service), /其他提供者/);
  assert.throws(() => owner.provide(serviceRef('provider', 'undeclared'), service), /非自有/);
  assert.throws(() => client.use(serviceRef('provider', 'undeclared')), /未声明服务/);
  const stranger = pluginContext(host, { ...consumer, requires: [] }, catalog, scope);
  assert.throws(() => stranger.optional(example), /未声明依赖/);
  scope.abort();
  assert.throws(() => owner.provide(example, service));
  await host.close();
});

test('legacy service fields and typed registration share a single value', async () => {
  const host = await Features.create(new EventEmitter() as Machines);
  const manifest = { ...provider, services: ['metrics'] };
  const context = pluginContext(host, manifest, [manifest], new PluginScope());
  const value = { value: 7 };
  context.provide(serviceRef<typeof value>('provider', 'metrics'), value);
  assert.equal(host.metrics, value);
  assert.equal(host.serviceValue('metrics'), value);
  assert.throws(() => {
    context.metrics = {} as typeof context.metrics;
  }, /已注册/);
  await host.close();
});
