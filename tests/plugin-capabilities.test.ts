/**
 * 模块职责：回归验证模块，围绕 `plugin-capabilities` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugin-capabilities`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: plugin jobs bind owner, revoke queued admission and wait for running cleanup; plugin storage cancels while queued and binds owner while holding real cleanup.
 */
type GatewayFixtureHost = import('../server/features.ts').Features;
type GatewayFixtureBody = Parameters<GatewayFixtureHost['route']>[3];
const admittedRouteFixtures = new WeakMap<GatewayFixtureHost, {
  gateway: import('../server/operation-gateway.ts').OperationGateway;
  bodies: WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>;
}>();
/** Preserve the fixture's data-directory setup before loading the real operation admission modules. */
/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: host: GatewayFixtureHost; req: import('node:http').IncomingMessage; res: import('node:http').ServerResponse; url: URL; body: GatewayFixtureBody。
 * 结果：返回分支计算值（`await fixture.gateway.dispatch(req, res, url) as boolean`），以 Promise 交付。
 * Result: Return the branch-computed value (`await fixture.gateway.dispatch(req, res, url) as boolean`) through a Promise.
 * 状态影响 / State effects: `fixture`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `admittedRouteFixtures.get`, `Promise.all`, `import`, `gateway.register`.
 */
async function routeThroughGateway(host: GatewayFixtureHost, req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse, url: URL, body: GatewayFixtureBody) {
  let fixture = admittedRouteFixtures.get(host);
  if (!fixture) {
    const [{ OperationGateway }, { operationEntries }] = await Promise.all([
      import('../server/operation-gateway.ts'), import('../server/operation-catalog.ts'),
    ]);
    const bodies = new WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>();
    const gateway = new OperationGateway({
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`host.enabled`）。
       * Result: Return the branch-computed value (`host.enabled`).
       */
      enabled: () => host.enabled,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: owner。
       * 结果：返回分支计算值（`owner === 'core' ? undefined : host.directory.get('official', owner)`）。
       * Result: Return the branch-computed value (`owner === 'core' ? undefined : host.directory.get('official', owner)`).
       * 协作入口 / Collaborators: `host.directory.get`.
       */
      instance: owner => owner === 'core' ? undefined : host.directory.get('official', owner),
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: _request; _url; _entry; _parameters; requireEnabled。
       * 结果：返回受控对象，公开字段包括 `check`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `check`; the actual branch determines its shape.
       * 协作入口 / Collaborators: `requireEnabled`.
       */
      bind: async (_request, _url, _entry, _parameters, requireEnabled) => {
        requireEnabled();
        return { /**
         * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
         * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`'owner'`），以 Promise 交付。
         * Result: Return the branch-computed value (`'owner'`) through a Promise.
         */
        check: async () => 'owner' };
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

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new Promise<void>((done) => setImmediate(done))`）。
 * Result: Return the branch-computed value (`new Promise<void>((done) => setImmediate(done))`).
 */
const turn = () => new Promise<void>((done) => setImmediate(done));
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
function deferred() { let resolve!: /**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`Object.assign(new EventEmitter(), { records: new Map(), live: new Map(), get: ()…`）。
 * Result: Return the branch-computed value (`Object.assign(new EventEmitter(), { records: new Map(), live: new Map(), get: ()…`).
 * 协作入口 / Collaborators: `Object.assign`.
 */
const machines = () => Object.assign(new EventEmitter(), { records: new Map(), live: new Map(), /**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`({})`）。
 * Result: Return the branch-computed value (`({})`).
 */
get: () => ({}) }) as unknown as Machines;
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: check: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `check`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(check(), 'operation did not reach the expected state')`.
 */
async function eventually(check: /**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) {
  for (let tries = 0; tries < 100; tries++) { if (check()) return; await new Promise((done) => setTimeout(done, 5)); }
  assert.ok(check(), 'operation did not reach the expected state');
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin jobs bind owner, revoke queued admission and wait for running cleanup
 * 协作入口 / Collaborators: `pluginCapabilities`, `machines`, `capability.jobs.create`, `hostRuntime.acquire`.
 * 检查边界 / Checked boundaries: `assert.equal(queued.owner, 'plugin:test-jobs')`; `assert.equal(calls, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin storage cancels while queued and binds owner while holding real cleanup
 * 协作入口 / Collaborators: `pluginCapabilities`, `machines`, `hostRuntime.acquire`, `process.cwd`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, { name: 'AbortError' })`; `assert.equal(ran, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin execution cancels queued admission and captures plugin/VM identity
 * 协作入口 / Collaborators: `randomUUID`, `machines`, `m.live.set`, `pluginCapabilities`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, { name: 'AbortError' })`; `assert.equal(ran, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scope cleanup timeout keeps the original disposer, and domain cleanup receipts require explicit recovery
 * 协作入口 / Collaborators: `deferred`, `scope.add`, `assert.rejects`, `withinDeadline`.
 * 检查边界 / Checked boundaries: `assert.rejects(withinDeadline(scope.dispose(), 10, 'cleanup'), /超过/)`; `assert.equal(done, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unload aborts active requests, blocks capabilities and retains failed service cleanup for retry
 * 状态影响 / State effects: `loaders.metrics`, `host`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `deferred`, `Features.create`, `machines`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(host.errors, {})`; `assert.rejects(active, { name: 'AbortError' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('unload aborts active requests, blocks capabilities and retains failed service cleanup for retry', async () => {
  const original = loaders.metrics, started = deferred(), cleanup = deferred(); let context!: PluginContext, closeCalls = 0;
  loaders.metrics = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...(await original()), activate: async (host) => { context = host; host.provi…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...(await original()), activate: async (host) => { context = host; host.provi…`) through a Promise.
   * 验证场景 / Scenario: unload aborts active requests, blocks capabilities and retains failed service cleanup for retry
   * 协作入口 / Collaborators: `original`.
   */
  async () => ({ ...(await original()), /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: host。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: unload aborts active requests, blocks capabilities and retains failed service cleanup for retry
   * 状态影响 / State effects: `context`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `host.provide`.
   */
  activate: async (host) => {
    context = host;
    host.provide(metricsContract.snapshots, { readSnapshot: async () => { throw new Error('unused snapshot fixture'); }, verifySnapshot: async () => { throw new Error('unused snapshot fixture'); } });
    host.provide(metricsContract.metrics, { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({})`），以 Promise 交付。
     * Result: Return the branch-computed value (`({})`) through a Promise.
     * 验证场景 / Scenario: unload aborts active requests, blocks capabilities and retains failed service cleanup for retry
     */
    sample: async () => ({}), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: unload aborts active requests, blocks capabilities and retains failed service cleanup for retry
     */
    forget: () => {}, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: unload aborts active requests, blocks capabilities and retains failed service cleanup for retry
     * 失败 / Failure: `new Error('retry cleanup')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    close: async () => { if (++closeCalls === 1) throw new Error('retry cleanup'); } } as any);
  }, operations: { sample: { response: (await original()).operations!.sample.response,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _url; _input; signal。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 验证场景 / Scenario: unload aborts active requests, blocks capabilities and retains failed service cleanup for retry
     * 协作入口 / Collaborators: `started.resolve`, `signal.throwIfAborted`.
     */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network scope waits for original handle closure and does not await a sibling with the same owner
 * 协作入口 / Collaborators: `networkDefaults`, `first.createServer`, `second.createServer`, `server.listen`.
 * 检查边界 / Checked boundaries: `assert.equal(closed, true)`; `assert.equal(sibling.listening, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin scope bounds synchronous registration before asynchronous resource admission
 * 协作入口 / Collaborators: `deferred`, `Array.from`, `assert.throws`, `turn`.
 * 检查边界 / Checked boundaries: `assert.throws(() => scope.run(() => gate.promise), { code: 'PLUGIN_QUEUE_FULL' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('plugin scope bounds synchronous registration before asynchronous resource admission', async () => {
  const scope = new PluginScope('plugin:bounded'), gate = deferred();
  const waiting = Array.from({ length: 128 }, () => scope.run(() => gate.promise));
  assert.throws(() => scope.run(() => gate.promise), { code: 'PLUGIN_QUEUE_FULL' });
  await turn(); gate.resolve(); await Promise.all(waiting); await scope.dispose();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed network disposal remains registered and can be retried
 * 状态影响 / State effects: `(scope as any).fetchAgent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `networkDefaults`, `assert.rejects`, `scope.close`, `runtime.close`.
 * 检查边界 / Checked boundaries: `assert.rejects(scope.close(), /not confirmed/)`; `assert.equal(calls, 2)`.
 */
test('failed network disposal remains registered and can be retried', async () => {
  const runtime = new NetworkRuntime(networkDefaults()), scope = new NetworkScope({ owner: 'plugin:network-retry', purpose: 'test' }, runtime);
  let calls = 0;
  (scope as any).fetchAgent = { /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: failed network disposal remains registered and can be retried
   * 失败 / Failure: `new Error('destroy not confirmed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  destroy: async () => { if (++calls === 1) throw new Error('destroy not confirmed'); } };
  await assert.rejects(scope.close(), /not confirmed/);
  await runtime.close(); assert.equal(calls, 2);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin job retry cannot bypass unresolved cleanup with a forged view
 * 状态影响 / State effects: `loaders.metrics`, `host`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Features.create`, `machines`, `assert.deepEqual`, `jobs.start`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(host.errors, {})`; `assert.equal(view.admission, 'cleanup-pending')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('plugin job retry cannot bypass unresolved cleanup with a forged view', async () => {
  const original = loaders.metrics; let context!: PluginContext;
  let jobs!: ReturnType<PluginContext['capabilities']['jobs']['create']>, retried = 0;
  loaders.metrics = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...(await original()), activate: async (host) => { context = host; jobs = hos…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...(await original()), activate: async (host) => { context = host; jobs = hos…`) through a Promise.
   * 验证场景 / Scenario: plugin job retry cannot bypass unresolved cleanup with a forged view
   * 协作入口 / Collaborators: `original`.
   */
  async () => ({ ...(await original()), /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: host。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: plugin job retry cannot bypass unresolved cleanup with a forged view
   * 状态影响 / State effects: `context`, `jobs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `host.capabilities.jobs.create`, `host.provide`, `host.registerJobs`.
   */
  activate: async (host) => {
    context = host; jobs = host.capabilities.jobs.create('retry', { persistent: false });
    host.provide(metricsContract.snapshots, { readSnapshot: async () => { throw new Error('unused snapshot fixture'); }, verifySnapshot: async () => { throw new Error('unused snapshot fixture'); } });
    host.provide(metricsContract.metrics, { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({})`），以 Promise 交付。
     * Result: Return the branch-computed value (`({})`) through a Promise.
     * 验证场景 / Scenario: plugin job retry cannot bypass unresolved cleanup with a forged view
     */
    sample: async () => ({}), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: plugin job retry cannot bypass unresolved cleanup with a forged view
     */
    forget: () => {}, jobs } as any); host.registerJobs(jobs, () => { retried++; });
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
