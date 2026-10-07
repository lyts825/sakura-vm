/**
 * 模块职责：回归验证模块，围绕 `plugin-service-ref` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugin-service-ref`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: lifecycle resolvers enforce declarations, readiness and drain dependency retention; typed service handles enforce ownership, dependencies and versions on every call.
 */
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
import { ServiceLifecycle } from '../server/service-lifecycle.ts';

const provider = definePlugin({ id: 'provider', name: 'Provider', description: 'test',
  category: 'operations', services: ['example'] });
const consumer = definePlugin({ id: 'consumer', name: 'Consumer', description: 'test',
  category: 'operations', requires: [pin('provider')] });
const example = serviceRef<{ value: number; /**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
call(): number }>('provider', 'example', { id: 'test.example.v1', version: 1, members: ['value', 'call'] });
/**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: context: PluginContext。
 * 结果：返回分支计算值（`value`）。
 * Result: Return the branch-computed value (`value`).
 * 协作入口 / Collaborators: `context.use`, `context.provide`.
 */
function checkTypes(context: PluginContext) {
  const value: number = context.use(example).value;
  // @ts-expect-error the reference requires a numeric value
  context.provide(example, { value: 'wrong' });
  return value;
}
void checkTypes;

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
 * 协作入口 / Collaborators: `graph.ready`, `graph.register`, `graph.startAll`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(resolver!.late<{ ping(): number }>('late').ping(), 2)`; `assert.deepEqual(events, ['consumer', 'provider'])`.
 */
test('lifecycle resolvers enforce declarations, readiness and drain dependency retention', async () => {
  const graph = new ServiceLifecycle(), events: string[] = [];
  graph.ready('@external', { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`3`）。
   * Result: Return the branch-computed value (`3`).
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   */
  ping: () => 3 });
  graph.register({ id: 'provider', requires: [], /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ping: () => 1 })`）。
   * Result: Return the branch-computed value (`({ ping: () => 1 })`).
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   */
  create: () => ({ /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`1`）。
   * Result: Return the branch-computed value (`1`).
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   */
  ping: () => 1 }), /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   */
  initialize: () => {},
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
     * 协作入口 / Collaborators: `events.push`.
     */
    dispose: () => { events.push('provider'); } });
  graph.register({ id: 'late', requires: [], /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ping: () => 2 })`）。
   * Result: Return the branch-computed value (`({ ping: () => 2 })`).
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   */
  create: () => ({ /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`2`）。
   * Result: Return the branch-computed value (`2`).
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   */
  ping: () => 2 }), /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   */
  initialize: () => {}, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   */
  dispose: () => {} });
  let resolver: import('../server/service-lifecycle.ts').ServiceDependencyResolver | undefined;
  graph.register({ id: 'consumer', requires: ['provider', '@external'], lateRequires: ['late'], /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: dependencies。
   * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   * 状态影响 / State effects: `resolver`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`, `dependencies.get<{ ping(): number }>('provider').ping`, `dependencies.get`, `assert.throws`.
   * 检查边界 / Checked boundaries: `assert.equal(dependencies.get<{ ping(): number }>('provider').ping(), 1)`; `assert.throws(() => dependencies.get('late'), { code: 'SERVICE_DEPENDENCY_DENIED' })`.
   */
  create: dependencies => {
    resolver = dependencies;
    assert.equal(dependencies.get<{ /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    ping(): number }>('provider').ping(), 1);
    assert.throws(() => dependencies.get('late'), { code: 'SERVICE_DEPENDENCY_DENIED' });
    assert.throws(() => dependencies.get('undeclared'), { code: 'SERVICE_DEPENDENCY_DENIED' });
    assert.throws(() => dependencies.late('late'), { code: 'SERVICE_NOT_READY' });
    return {};
  }, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   */
  initialize: () => {}, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: _value; dependencies。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: lifecycle resolvers enforce declarations, readiness and drain dependency retention
   * 协作入口 / Collaborators: `assert.equal`, `dependencies.get<{ ping(): number }>('provider').ping`, `dependencies.get`, `assert.throws`.
   * 检查边界 / Checked boundaries: `assert.equal(dependencies.get<{ ping(): number }>('provider').ping(), 1)`; `assert.throws(() => dependencies.late('late'), { code: 'SERVICE_DRAINING' })`.
   */
  dispose: (_value, dependencies) => {
    assert.equal(dependencies.get<{ /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    ping(): number }>('provider').ping(), 1);
    assert.throws(() => dependencies.late('late'), { code: 'SERVICE_DRAINING' });
    events.push('consumer');
  } });
  await graph.startAll();
  assert.equal(resolver!.late<{ /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  ping(): number }>('late').ping(), 2);
  await graph.close();
  assert.deepEqual(events, ['consumer', 'provider']);
  assert.throws(() => resolver!.get('provider'), { code: 'SERVICE_NOT_READY' });
  assert.throws(() => resolver!.get('@external'), { code: 'SERVICE_NOT_READY' });
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: optional = false。
 * 结果：返回受控对象，公开字段包括 `directory, owner, client, broker, manifest`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `directory, owner, client, broker, manifest`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `pin`, `directory.begin`, `'a'.repeat`, `'b'.repeat`.
 */
function fixture(optional = false) {
  const directory = new PluginDirectory(), catalog = [provider, optional ? { ...consumer, requires: [], optional: [pin('provider')] } : consumer];
  const owner = directory.begin('official', 'provider', provider.version, 'a'.repeat(64));
  const client = directory.begin('official', 'consumer', consumer.version, 'b'.repeat(64));
  directory.publish(client);
  const broker = new ServiceBroker(directory, catalog);
  return { directory, owner, client, broker, manifest: catalog[1] };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: typed service handles enforce ownership, dependencies and versions on every call
 * 状态影响 / State effects: `owner.phase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `broker.lookup`, `broker.register`.
 * 检查边界 / Checked boundaries: `assert.equal(broker.lookup(client, manifest, example, true), undefined)`; `assert.equal(broker.register(owner, example, raw), raw)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('typed service handles enforce ownership, dependencies and versions on every call', async () => {
  const { directory, owner, client, broker, manifest } = fixture();
  try {
    assert.equal(broker.lookup(client, manifest, example, true), undefined);
    const raw = { value: 42, /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`42`）。
     * Result: Return the branch-computed value (`42`).
     * 验证场景 / Scenario: typed service handles enforce ownership, dependencies and versions on every call
     */
    call: () => 42 };
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
    broker.register(successor, example, { value: 7, /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`7`）。
     * Result: Return the branch-computed value (`7`).
     * 验证场景 / Scenario: typed service handles enforce ownership, dependencies and versions on every call
     */
    call: () => 7 }); directory.publish(successor);
    assert.throws(cached, { code: 'PLUGIN_REVOKED' });
    assert.equal(broker.lookup(client, manifest, example)!.call(), 7);
    await successor.scope.dispose();
  } finally { await owner.scope.dispose(); await client.scope.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: revocation rechecks queued work and keeps provider ownership and caller identity
 * 协作入口 / Collaborators: `fixture`, `runtime.acquire`, `serviceRef`, `broker.register`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, { code: 'PLUGIN_PERMISSION_DENIED' })`; `assert.equal(invoked, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('revocation rechecks queued work and keeps provider ownership and caller identity', async () => {
  const { directory, owner, client, broker, manifest } = fixture();
  const runtime = new HostRuntime({ budgets: { work: { capacity: 1 } } });
  const block = await runtime.acquire({ owner: 'block', kind: 'test', label: 'block', cost: { work: 1 } });
  const ref = serviceRef<{ /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  run(): Promise<void> }>('provider', 'example', { id: 'test.example.v1', version: 1, members: ['run'] });
  let invoked = false;
  broker.register(owner, ref, { /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: revocation rechecks queued work and keeps provider ownership and caller identity
   * 状态影响 / State effects: `invoked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`, `resourceContext`, `runtime.acquire`, `lease.release`.
   * 检查边界 / Checked boundaries: `assert.equal(resourceContext()?.pluginGeneration, owner.generation)`; `assert.equal(resourceContext()?.callerPluginGeneration, client.generation)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  async run() {
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: optional discovery does not pin an idle provider and retained nested handles revoke
 * 协作入口 / Collaborators: `fixture`, `serviceRef`, `broker.register`, `directory.publish`.
 * 检查边界 / Checked boundaries: `assert.equal(broker.activeBorrows(owner), 0)`; `assert.equal(nested.ping(), 1)`.
 */
test('optional discovery does not pin an idle provider and retained nested handles revoke', async () => {
  const { directory, owner, client, broker, manifest } = fixture(true);
  const ref = serviceRef<{ nested: { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  ping(): number } }>('provider', 'example', { id: 'test.example.v1', version: 1, members: ['nested'], properties: { nested: { id: 'test.nested.v1', version: 1, members: ['ping'] } } });
  broker.register(owner, ref, { nested: { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`1`）。
   * Result: Return the branch-computed value (`1`).
   * 验证场景 / Scenario: optional discovery does not pin an idle provider and retained nested handles revoke
   */
  ping: () => 1 } }); directory.publish(owner);
  const nested = broker.lookup(client, manifest, ref)!.nested;
  assert.equal(broker.activeBorrows(owner), 0); assert.equal(nested.ping(), 1);
  owner.revoke(); assert.throws(() => nested.ping(), { code: 'PLUGIN_REVOKED' });
  assert.equal(broker.lookup(client, manifest, ref, true), undefined);
  await owner.scope.dispose(); await client.scope.dispose();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cached returned async callables retain both scopes until their original invocation finishes
 * 协作入口 / Collaborators: `fixture`, `serviceRef`, `broker.register`, `directory.publish`.
 * 检查边界 / Checked boundaries: `assert.equal(broker.activeBorrows(owner), 1)`; `assert.equal(owner.scope.diagnostics().active, 1)`.
 */
test('cached returned async callables retain both scopes until their original invocation finishes', async () => {
  const { directory, owner, client, broker, manifest } = fixture();
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const ref = serviceRef<{ /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  callable(): /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: callback: () => string | undefined。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (callback: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => string | undefined) => Promise<void> }>('provider', 'example', { id: 'test.example.v1', version: 1, members: ['callable'] });
  broker.register(owner, ref, { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`async (callback) => { assert.equal(pluginAuthority(), owner); assert.equal(resou…`）。
   * Result: Return the branch-computed value (`async (callback) => { assert.equal(pluginAuthority(), owner); assert.equal(resou…`).
   * 验证场景 / Scenario: cached returned async callables retain both scopes until their original invocation finishes
   */
  callable: () => async (callback) => {
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: nested calls through returned callables preserve the original caller and callback authority
 * 协作入口 / Collaborators: `definePlugin`, `pin`, `directory.begin`, `'a'.repeat`.
 * 检查边界 / Checked boundaries: `assert.equal(called, true)`.
 */
test('nested calls through returned callables preserve the original caller and callback authority', async () => {
  const directory = new PluginDirectory();
  const middleManifest = { ...consumer, services: ['example'] };
  const originalManifest = definePlugin({ id: 'original', name: 'Original', description: 'test',
    category: 'operations', requires: [pin('consumer')] });
  const owner = directory.begin('official', 'provider', provider.version, 'a'.repeat(64));
  const middle = directory.begin('official', 'consumer', consumer.version, 'b'.repeat(64));
  const original = directory.begin('official', 'original', originalManifest.version, 'c'.repeat(64));
  const broker = new ServiceBroker(directory, [provider, middleManifest, originalManifest]);
  const ref = serviceRef<{ /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  callable(): /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: callback: () => void。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (callback: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) => void }>('provider', 'example', { id: 'test.example.v1', version: 1, members: ['callable'] });
  broker.register(owner, ref, { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`(callback) => { assert.equal(pluginAuthority(), owner); assert.equal(resourceCon…`）。
   * Result: Return the branch-computed value (`(callback) => { assert.equal(pluginAuthority(), owner); assert.equal(resourceCon…`).
   * 验证场景 / Scenario: nested calls through returned callables preserve the original caller and callback authority
   */
  callable: () => (callback) => {
    assert.equal(pluginAuthority(), owner);
    assert.equal(resourceContext()?.callerPluginGeneration, original.generation);
    callback();
  } });
  directory.publish(owner);
  const callable = broker.lookup(middle, middleManifest, ref)!.callable();
  const middleRef = serviceRef<{ /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: callback: () => void。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  run(callback: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void): void }>('consumer', 'example', { id: 'test.middle.v1', version: 1, members: ['run'] });
  broker.register(middle, middleRef, { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: callback。
   * 结果：返回分支计算值（`callable(callback)`）。
   * Result: Return the branch-computed value (`callable(callback)`).
   * 验证场景 / Scenario: nested calls through returned callables preserve the original caller and callback authority
   * 协作入口 / Collaborators: `callable`.
   */
  run: (callback) => callable(callback) });
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: observed and scoped cleanup failures retain one original recovery while ordinary cancellation does not
 * 协作入口 / Collaborators: `Promise.reject`, `scope.observe`, `assert.rejects`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(observed, (failure) => failure === error)`; `assert.equal(scope.diagnostics().cleanup.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: contexts are immutable independent objects with no writable service slots
 * 协作入口 / Collaborators: `Features.create`, `assert.deepEqual`, `host.pluginResources`, `host.close`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(host.pluginResources(), [])`.
 */
test('contexts are immutable independent objects with no writable service slots', async () => {
  const host = await Features.create(new EventEmitter() as Machines);
  assert.deepEqual(host.pluginResources(), []);
  await host.close();
});
