/**
 * 模块职责：回归验证模块，围绕 `plugin-public-boundaries` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugin-public-boundaries`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: public service descriptors deny implementation fields and consumer lifecycle while unregister receipts survive revocation; queued metadata rechecks the originating generation before editing or publishing.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: public service descriptors deny implementation fields and consumer lifecycle while unregister receipts survive revocation
 * 协作入口 / Collaborators: `definePlugin`, `pin`, `directory.begin`, `'a'.repeat`.
 * 检查边界 / Checked boundaries: `assert.throws(() => Reflect.get(borrowed, 'configListeners'), { code: 'PLUGIN_SERVICE_PRIVATE' })`; `assert.throws(() => Reflect.get(borrowed, 'machines'), { code: 'PLUGIN_SERVICE_PRIVATE' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queued metadata rechecks the originating generation before editing or publishing
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.rejects(queued, { code: 'PLUGIN_REVOKED' })`; `assert.equal((await store.read()).value.value, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('queued metadata rechecks the originating generation before editing or publishing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-plugin-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = new PluginDirectory(),
    instance = directory.begin('official', 'metadata', '1', 'a'.repeat(64));
  directory.publish(instance);
  const store = new MetadataStore(join(root, 'metadata.json'), { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ value: 0 })`）。
   * Result: Return the branch-computed value (`({ value: 0 })`).
   * 验证场景 / Scenario: queued metadata rechecks the originating generation before editing or publishing
   */
  fallback: () => ({ value: 0 }) });
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the UI consumes only contributions published for a running generation
 * 协作入口 / Collaborators: `directory.begin`, `'a'.repeat`, `instance.contribute`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(pluginSurfaceEnabled(['metrics'], 'tabs', 'metrics', directory.view()), false)`; `assert.equal(pluginSurfaceEnabled(['metrics'], 'tabs', 'metrics', directory.view()), true)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: broker data responses preserve null-prototype GraphQL records
 * 协作入口 / Collaborators: `definePlugin`, `directory.begin`, `'a'.repeat`, `serviceRef`.
 * 检查边界 / Checked boundaries: `assert.equal(JSON.stringify(broker.lookup(instance, manifest, ref)!.query()), '{"data":{"vms":[]}}')`.
 */
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
  const value = { /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ data: Object.assign(Object.create(null), { vms: [] }) })`）。
   * Result: Return the branch-computed value (`({ data: Object.assign(Object.create(null), { vms: [] }) })`).
   * 验证场景 / Scenario: broker data responses preserve null-prototype GraphQL records
   * 协作入口 / Collaborators: `Object.assign`, `Object.create`.
   */
  query: () => ({ data: Object.assign(Object.create(null), { vms: [] }) }) };
  const ref = serviceRef<typeof value>('data', 'query', { id: 'test.query.v1', version: 1, members: ['query'] });
  broker.register(instance, ref, value);
  directory.publish(instance);
  assert.equal(JSON.stringify(broker.lookup(instance, manifest, ref)!.query()), '{"data":{"vms":[]}}');
  await instance.scope.dispose();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed async unregister receipts can retry after the consumer and provider are revoked
 * 协作入口 / Collaborators: `definePlugin`, `pin`, `directory.begin`, `'a'.repeat`.
 * 检查边界 / Checked boundaries: `assert.rejects(unregister(), /not confirmed/)`; `assert.equal(attempts, 3)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`cleanupReceipt(async () => { if (++attempts < 3) throw new Error('original clean…`）。
     * Result: Return the branch-computed value (`cleanupReceipt(async () => { if (++attempts < 3) throw new Error('original clean…`).
     * 验证场景 / Scenario: failed async unregister receipts can retry after the consumer and provider are revoked
     * 协作入口 / Collaborators: `cleanupReceipt`.
     */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: promised cleanup receipts arriving after revocation retain original cleanup and recover both scopes
 * 状态影响 / State effects: `confirmed`, `owner.phase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `definePlugin`, `pin`, `directory.begin`, `'a'.repeat`.
 * 检查边界 / Checked boundaries: `assert.rejects(owner.scope.dispose(), AggregateError)`; `assert.rejects(consumer.scope.dispose(), AggregateError)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('promised cleanup receipts arriving after revocation retain original cleanup and recover both scopes', async () => {
  const directory = new PluginDirectory();
  const provider = definePlugin({ id: 'receipt', name: 'receipt', description: 'test',
    category: 'operations', services: ['api'] });
  const client = definePlugin({ id: 'client', name: 'client', description: 'test',
    category: 'operations', requires: [pin('receipt')] });
  const owner = directory.begin('official', provider.id, provider.version, 'a'.repeat(64));
  const consumer = directory.begin('official', client.id, client.version, 'b'.repeat(64));
  const broker = new ServiceBroker(directory, [provider, client]);
  let releaseReceipt!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const blocked = new Promise<void>((resolve) => { releaseReceipt = resolve; });
  let confirmed = false, attempts = 0;
  const failure = new AppError('original cleanup not confirmed', 503, 'TEST_CLEANUP_UNCONFIRMED');
  const api = { /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`cleanupReceipt(async () => { ++attempts; assert.equal(pluginAuthority(), owner);…`），以 Promise 交付。
   * Result: Return the branch-computed value (`cleanupReceipt(async () => { ++attempts; assert.equal(pluginAuthority(), owner);…`) through a Promise.
   * 验证场景 / Scenario: promised cleanup receipts arriving after revocation retain original cleanup and recover both scopes
   * 协作入口 / Collaborators: `cleanupReceipt`.
   */
  subscribe: async () => {
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
  broker.register(successor, ref, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`cleanupReceipt(async () => { throw new Error('old receipt called the new generat…`），以 Promise 交付。
   * Result: Return the branch-computed value (`cleanupReceipt(async () => { throw new Error('old receipt called the new generat…`) through a Promise.
   * 验证场景 / Scenario: promised cleanup receipts arriving after revocation retain original cleanup and recover both scopes
   * 协作入口 / Collaborators: `cleanupReceipt`.
   */
  subscribe: async () => cleanupReceipt(async () => {
    throw new Error('old receipt called the new generation');
  }) });
  directory.publish(successor);
  await unregister();
  assert.equal(attempts, completedAttempts);
  await successor.scope.dispose();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: boot providers registered through VM ports retain host identity, generation and cleanup receipts
 * 协作入口 / Collaborators: `directory.begin`, `'a'.repeat`, `Object.assign`, `vmAccess`.
 * 检查边界 / Checked boundaries: `assert.throws(() => provider.prepare({} as never, () => {}), { code: 'PLUGIN_REVOKED' })`; `assert.equal(closed, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('boot providers registered through VM ports retain host identity, generation and cleanup receipts', async () => {
  const directory = new PluginDirectory(),
    instance = directory.begin('system', 'boot', '1', 'a'.repeat(64));
  const host = Object.assign(new EventEmitter(), { live: new Map() });
  const port = vmAccess(host as never, instance.scope, instance);
  let closed = 0;
  withPluginAuthority(instance, () =>
    registerVmBootProvider(port, 'fixture', {
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回受控对象，公开字段包括 `args, close`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `args, close`; the actual branch determines its shape.
       * 验证场景 / Scenario: boot providers registered through VM ports retain host identity, generation and cleanup receipts
       * 协作入口 / Collaborators: `assert.equal`, `resourceContext`.
       * 检查边界 / Checked boundaries: `assert.equal(resourceContext()?.pluginGeneration, instance.generation)`.
       */
      prepare: async () => {
        assert.equal(resourceContext()?.pluginGeneration, instance.generation);
        return {
          args: [],
          /**
           * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
           * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 验证场景 / Scenario: boot providers registered through VM ports retain host identity, generation and cleanup receipts
           */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cached VM transports check permissions and original VM identity while retaining their own close handle
 * 协作入口 / Collaborators: `directory.begin`, `'a'.repeat`, `Object.assign`, `vmAccess`.
 * 检查边界 / Checked boundaries: `assert.equal(commands, 1)`; `assert.throws(() => Reflect.get(client, '_sock'), { code: 'PLUGIN_SERVICE_PRIVATE' })`.
 */
test('cached VM transports check permissions and original VM identity while retaining their own close handle', async () => {
  const directory = new PluginDirectory(),
    instance = directory.begin('official', 'transport', '1', 'a'.repeat(64));
  const raw = Object.assign(new EventEmitter(), {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: cached VM transports check permissions and original VM identity while retaining their own close handle
     */
    exec: () => {
      ++commands;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: cached VM transports check permissions and original VM identity while retaining their own close handle
     */
    destroy: () => {
      ++closed;
    },
    _sock: {},
  });
  let commands = 0,
    closed = 0;
  const host = Object.assign(new EventEmitter(), { live: new Map([['vm', {}]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`raw`），以 Promise 交付。
   * Result: Return the branch-computed value (`raw`) through a Promise.
   * 验证场景 / Scenario: cached VM transports check permissions and original VM identity while retaining their own close handle
   */
  connect: async () => raw });
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
