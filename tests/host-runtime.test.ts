/**
 * 模块职责：回归验证模块，围绕 `host-runtime` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `host-runtime`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: phase quantiles use a bounded rolling window and separate resource lifetime from task execution; atomic admission never holds an available dimension while queued for another.
 */
import assert from 'node:assert/strict';
import { RuntimeTimings } from '../server/runtime-timings.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: phase quantiles use a bounded rolling window and separate resource lifetime from task execution
 * 状态影响 / State effects: `clock`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `timings.observe`, `timings.snapshot`, `assert.equal`, `timings.start`.
 * 检查边界 / Checked boundaries: `assert.equal(view.series[0].samples, 1024)`; `assert.equal(view.series[0].p95Ms, 1149)`.
 */
test('phase quantiles use a bounded rolling window and separate resource lifetime from task execution', async () => {
  let clock = 0;
  const timings = new RuntimeTimings(() => clock);
  for (let index = 1; index <= 1200; index++) timings.observe('job', 'execution', index);
  timings.observe('resource', 'resource-lifetime', 90_000);
  const view = timings.snapshot();
  assert.equal(view.series[0].samples, 1024);
  assert.equal(view.series[0].p95Ms, 1149);
  assert.equal(view.series[0].p99Ms, 1190);
  assert.equal(view.series[1].p99Ms, 90_000);
  const finish = timings.start('compute', 'cleanup'); clock = 10; finish(); finish();
  assert.equal(timings.snapshot().series.find(entry => entry.source === 'compute')!.samples, 1);
  const primary = new Error('primary');
  await assert.rejects(timings.measure('http', 'execution', () => { throw primary; }), error => error === primary);
  clock = 60_011; assert.deepEqual(timings.snapshot().series, []);
});
import test from 'node:test';
import { HostRuntime, withResourceContext, resourceContext, captureResourceContext } from '../server/host-runtime/index.ts';
import { ResourceScope } from '../server/resource-scope.ts';

/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: owner: string; cost: Record<string, number> = { jobs: 1 }。
 * 结果：返回分支计算值（`({ owner, kind: 'test', label: 'owned test', cost })`）。
 * Result: Return the branch-computed value (`({ owner, kind: 'test', label: 'owned test', cost })`).
 */
const request = (owner: string, cost: Record<string, number> = { jobs: 1 }) => ({ owner, kind: 'test', label: 'owned test', cost });
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new Promise<void>(resolve => setImmediate(resolve))`）。
 * Result: Return the branch-computed value (`new Promise<void>(resolve => setImmediate(resolve))`).
 */
const immediate = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: atomic admission never holds an available dimension while queued for another
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `assert.equal`, `runtime.snapshot`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.snapshot().queued, 1)`; `assert.equal(runtime.snapshot().budgets.find(b => b.key === 'jobs')?.used, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('atomic admission never holds an available dimension while queued for another', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 }, io: { capacity: 1 } } });
  const io = await runtime.acquire(request('disk', { io: 1 }));
  const blocked = runtime.acquire(request('both', { jobs: 1, io: 1 }));
  const independent = await runtime.acquire(request('job'));
  assert.equal(runtime.snapshot().queued, 1);
  independent.release();
  assert.equal(runtime.snapshot().budgets.find(b => b.key === 'jobs')?.used, 0);
  io.release();
  const both = await blocked;
  assert.ok(runtime.snapshot().budgets.every(b => b.used === 1));
  both.release(); both.release();
  assert.ok(runtime.snapshot().budgets.every(b => b.used === 0));
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: control has reserved execution and queue capacity when ordinary work is saturated
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `assert.rejects`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runtime.acquire(request('overflow')), { code: 'RESOURCE_QUEUE_FULL' })`; `assert.equal(runtime.snapshot().budgets[0].used, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('control has reserved execution and queue capacity when ordinary work is saturated', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 2, reserved: 1 } }, queueLimit: 2, controlQueueReserve: 1 });
  const active = await runtime.acquire(request('active'));
  const waiting = runtime.acquire(request('waiting'));
  await assert.rejects(runtime.acquire(request('overflow')), { code: 'RESOURCE_QUEUE_FULL' });
  const control = await runtime.acquire({ ...request('cleanup'), lane: 'control' });
  assert.equal(runtime.snapshot().budgets[0].used, 2);
  control.release();
  assert.equal(runtime.snapshot().queued, 1);
  active.release();
  (await waiting).release();
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: owners alternate under contention and cancelling a waiter consumes no capacity
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `assert.rejects`, `abort.abort`.
 * 检查边界 / Checked boundaries: `assert.rejects(cancelled, { name: 'AbortError' })`; `assert.equal(runtime.snapshot().resources.find(v => v.state === 'active')?.owner, 'b')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('owners alternate under contention and cancelling a waiter consumes no capacity', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const active = await runtime.acquire(request('a'));
  const a = runtime.acquire(request('a'));
  const abort = new AbortController();
  const cancelled = runtime.acquire({ ...request('cancelled'), signal: abort.signal });
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  const b = runtime.acquire(request('b'));
  abort.abort(); await rejected;
  active.release();
  const other = await b;
  assert.equal(runtime.snapshot().resources.find(v => v.state === 'active')?.owner, 'b');
  other.release(); (await a).release();
  assert.equal(runtime.snapshot().totals.cancelled, 1);
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: partition budgets span owners and disappear only after active and queued references end
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `assert.rejects`, `first.release`.
 * 检查边界 / Checked boundaries: `assert.rejects(runtime.acquire({ ...request('bad'), partitions: [{ key: 'volume:one', limit: 2 }] }), { code: 'RESOURCE_PARTITION_…`; `assert.equal(runtime.snapshot().budgets.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('partition budgets span owners and disappear only after active and queued references end', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 4 } } });
  const partitions = [{ key: 'volume:one', limit: 1 }];
  const first = await runtime.acquire({ ...request('backup'), partitions });
  const second = runtime.acquire({ ...request('sync'), partitions });
  await assert.rejects(runtime.acquire({ ...request('bad'), partitions: [{ key: 'volume:one', limit: 2 }] }), { code: 'RESOURCE_PARTITION_CONFLICT' });
  first.release(); (await second).release();
  assert.equal(runtime.snapshot().budgets.length, 1);
  const resized = await runtime.acquire({ ...request('new'), partitions: [{ key: 'volume:one', limit: 2 }] });
  resized.release(); runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelled active work and failed cleanup retain capacity until its owner confirms release
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `abort.abort`, `lease.cleanupPending`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.snapshot().budgets[0].used, 1)`; `assert.equal(runtime.snapshot().resources[0].state, 'cleanup-pending')`.
 */
test('cancelled active work and failed cleanup retain capacity until its owner confirms release', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const abort = new AbortController();
  const lease = await runtime.acquire({ ...request('process'), signal: abort.signal });
  abort.abort(); lease.cleanupPending(new Error('physical process exit unconfirmed'));
  assert.equal(runtime.snapshot().budgets[0].used, 1);
  assert.equal(runtime.snapshot().resources[0].state, 'cleanup-pending');
  assert.throws(() => runtime.close(), { code: 'RESOURCE_CLEANUP_PENDING' });
  lease.release(); runtime.close();
  assert.equal(runtime.snapshot().state, 'closed');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: drain rejects queued and new work but admits bounded cleanup until close
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `assert.rejects`, `runtime.beginDrain`.
 * 检查边界 / Checked boundaries: `assert.rejects(waiting, { code: 'RESOURCE_DRAINING' })`; `assert.rejects(runtime.acquire(request('late')), { code: 'RESOURCE_DRAINING' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('drain rejects queued and new work but admits bounded cleanup until close', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 2, reserved: 1 } } });
  const lease = await runtime.acquire(request('owned'));
  const waiting = runtime.acquire(request('queued'));
  const rejected = assert.rejects(waiting, { code: 'RESOURCE_DRAINING' });
  runtime.beginDrain(); await rejected;
  await assert.rejects(runtime.acquire(request('late')), { code: 'RESOURCE_DRAINING' });
  const cleanup = await runtime.acquire({ ...request('cleanup'), lane: 'control' });
  cleanup.release(); lease.release(); runtime.close();
  await assert.rejects(runtime.acquire({ ...request('closed'), lane: 'control' }), { code: 'RESOURCE_DRAINING' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queue deadlines free listeners, registry entries and partition references
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `assert.rejects`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runtime.acquire({ ...request('deadline'), timeoutMs: 10, partitions: [{ key: 'temporary', limit: 1 }] }), { code: '…`; `assert.equal(runtime.snapshot().queued, 0)`.
 */
test('queue deadlines free listeners, registry entries and partition references', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const lease = await runtime.acquire(request('active'));
  await assert.rejects(runtime.acquire({ ...request('deadline'), timeoutMs: 10,
    partitions: [{ key: 'temporary', limit: 1 }] }), { code: 'RESOURCE_WAIT_TIMEOUT' });
  assert.equal(runtime.snapshot().queued, 0);
  assert.equal(runtime.snapshot().budgets.length, 1);
  lease.release(); runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid costs and partition declarations cannot alter budget accounting
 * 协作入口 / Collaborators: `assert.rejects`, `runtime.acquire`, `request`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runtime.acquire(request('invalid', { jobs: value })), { code: 'RESOURCE_INVALID' })`; `assert.rejects(runtime.acquire(request('large', { jobs: 2 })), { code: 'RESOURCE_CAPACITY' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('invalid costs and partition declarations cannot alter budget accounting', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  for (const value of [0, -1, NaN, Infinity, 0.5])
    await assert.rejects(runtime.acquire(request('invalid', { jobs: value })), { code: 'RESOURCE_INVALID' });
  await assert.rejects(runtime.acquire(request('large', { jobs: 2 })), { code: 'RESOURCE_CAPACITY' });
  await assert.rejects(runtime.acquire(request('unknown', { unknown: 1 })), { code: 'RESOURCE_INVALID' });
  await assert.rejects(runtime.acquire({ ...request('duplicate'), partitions: [{ key: 'same', limit: 1 }, { key: 'same', limit: 1 }] }), { code: 'RESOURCE_INVALID' });
  assert.equal(runtime.snapshot().resources.length, 0);
  assert.equal(runtime.snapshot().budgets.length, 1);
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resource identities survive async boundaries without crossing unrelated requests
 * 协作入口 / Collaborators: `Promise.all`, `['alice', 'bob'].map`, `assert.equal`, `assert.notEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(contexts[0].actorId, 'alice')`; `assert.equal(contexts[1].actorId, 'bob')`.
 */
test('resource identities survive async boundaries without crossing unrelated requests', async () => {
  const runtime = new HostRuntime();
  const contexts = await Promise.all(['alice', 'bob'].map(actorId => withResourceContext({ actorId, owner: 'plugin:owned', vmId: actorId }, async () => {
    const identity = captureResourceContext();
    await immediate();
    assert.equal(resourceContext()?.operationId, identity.operationId);
    const lease = runtime.register({ owner: 'plugin:owned', kind: 'test', label: actorId });
    const view = runtime.snapshot().resources.find(v => v.id === lease.id)!;
    lease.release(); return view.identity;
  })));
  assert.equal(contexts[0].actorId, 'alice');
  assert.equal(contexts[1].actorId, 'bob');
  assert.notEqual(contexts[0].operationId, contexts[1].operationId);
  assert.equal(resourceContext(), undefined);
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ownership transfer and snapshot mutation cannot release or overwrite another lease
 * 状态影响 / State effects: `snapshot.resources[0].owner`, `snapshot.resources[0].identity.owner`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `lease.transfer`, `runtime.snapshot`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.snapshot().resources[0].owner, 'user:application')`; `assert.equal(runtime.snapshot().resources[0].previousOwner, 'launcher')`.
 */
test('ownership transfer and snapshot mutation cannot release or overwrite another lease', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const lease = await runtime.acquire(request('launcher'));
  lease.transfer('user:application');
  const snapshot = runtime.snapshot();
  snapshot.resources[0].owner = 'changed';
  snapshot.resources[0].identity.owner = 'changed';
  assert.equal(runtime.snapshot().resources[0].owner, 'user:application');
  assert.equal(runtime.snapshot().resources[0].previousOwner, 'launcher');
  assert.equal(runtime.snapshot().budgets[0].used, 1);
  lease.release();
  assert.throws(() => lease.transfer('late'), { code: 'RESOURCE_RELEASED' });
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scope cleanup failure stays registered and explicit retry only retries failed resources
 * 协作入口 / Collaborators: `scope.defer`, `assert.rejects`, `scope.close`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(scope.close(), AggregateError)`; `assert.equal(scope.signal.aborted, true)`.
 */
test('scope cleanup failure stays registered and explicit retry only retries failed resources', async () => {
  const runtime = new HostRuntime(), scope = new ResourceScope({ owner: 'vm:one', registry: runtime });
  let attempts = 0, successful = 0;
  scope.defer('failed attachment', () => { if (++attempts === 1) throw new Error('still running'); });
  scope.defer('successful attachment', () => { ++successful; });
  await assert.rejects(scope.close(), AggregateError);
  assert.equal(scope.signal.aborted, true);
  assert.equal(runtime.snapshot().resources.length, 1);
  assert.equal(runtime.snapshot().resources[0].state, 'cleanup-pending');
  await scope.retryCleanup();
  assert.equal(attempts, 2); assert.equal(successful, 1);
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: nested scopes propagate cancellation and shutdown awaits child disposal
 * 协作入口 / Collaborators: `parent.child`, `child.defer`, `parent.close`, `immediate`.
 * 检查边界 / Checked boundaries: `assert.equal(parent.signal.aborted, true)`; `assert.equal(child.signal.aborted, true)`.
 */
test('nested scopes propagate cancellation and shutdown awaits child disposal', async () => {
  const runtime = new HostRuntime(), parent = new ResourceScope({ owner: 'app', registry: runtime });
  const child = parent.child('vm', 0, 'vm:one');
  let finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  child.defer('owned process', () => waiting);
  const closing = parent.close();
  await immediate();
  assert.equal(parent.signal.aborted, true); assert.equal(child.signal.aborted, true);
  assert.equal(runtime.snapshot().resources.length, 2);
  finish(); await closing; runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: parent cleanup retry reaches failed descendants without losing their ownership
 * 协作入口 / Collaborators: `parent.child`, `child.defer`, `assert.rejects`, `parent.close`.
 * 检查边界 / Checked boundaries: `assert.rejects(parent.close(), AggregateError)`; `assert.equal(runtime.snapshot().resources.length, 2)`.
 */
test('parent cleanup retry reaches failed descendants without losing their ownership', async () => {
  const runtime = new HostRuntime(), parent = new ResourceScope({ owner: 'app', registry: runtime });
  const child = parent.child('vm');
  let calls = 0;
  child.defer('attachment', () => { if (++calls === 1) throw new Error('failed once'); });
  await assert.rejects(parent.close(), AggregateError);
  assert.equal(runtime.snapshot().resources.length, 2);
  await parent.retryCleanup();
  assert.equal(calls, 2); runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: identities are whitelisted before diagnostics and invalid context cannot leak a registry entry
 * 协作入口 / Collaborators: `runtime.register`, `assert.equal`, `JSON.stringify(runtime.snapshot()).includes`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.equal(JSON.stringify(runtime.snapshot()).includes('never expose'), false)`; `assert.equal(JSON.stringify(runtime.snapshot()).includes('argv'), false)`.
 */
test('identities are whitelisted before diagnostics and invalid context cannot leak a registry entry', async () => {
  const runtime = new HostRuntime();
  const identity = { owner: 'plugin:one', password: 'never expose', argv: ['secret'] };
  const lease = runtime.register({ owner: 'plugin:one', kind: 'test', label: 'owned', identity });
  assert.equal(JSON.stringify(runtime.snapshot()).includes('never expose'), false);
  assert.equal(JSON.stringify(runtime.snapshot()).includes('argv'), false);
  lease.release();
  assert.throws(() => runtime.register({ owner: 'valid', kind: 'test', label: 'owned', identity: { actorId: '\ninvalid' } }), /Invalid resource identity/);
  assert.equal(runtime.snapshot().resources.length, 0);
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bounded owner queues protect unrelated owners and reject callbacks cannot strand resources
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `assert.rejects`, `lease.release`.
 * 检查边界 / Checked boundaries: `assert.rejects(runtime.acquire(request('flood')), { code: 'RESOURCE_QUEUE_FULL' })`; `assert.rejects(runtime.acquire({ ...request('callback'), onQueued() { throw new Error('observer failed'); } }), /observer failed/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('bounded owner queues protect unrelated owners and reject callbacks cannot strand resources', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } }, ownerQueueLimit: 1 });
  const lease = await runtime.acquire(request('active'));
  const queued = runtime.acquire(request('flood'));
  await assert.rejects(runtime.acquire(request('flood')), { code: 'RESOURCE_QUEUE_FULL' });
  await assert.rejects(runtime.acquire({ ...request('callback'), /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: bounded owner queues protect unrelated owners and reject callbacks cannot strand resources
   * 失败 / Failure: `new Error('observer failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  onQueued() { throw new Error('observer failed'); } }), /observer failed/);
  const other = runtime.acquire(request('other'));
  lease.release(); (await queued).release(); (await other).release();
  assert.equal(runtime.snapshot().queued, 0); runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lease resize checks all held dimensions atomically and rejects new dimensions
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `assert.throws`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.throws(() => first.resize({ jobs: 3, io: 3 }), { code: 'RESOURCE_CAPACITY' })`; `assert.deepEqual(runtime.snapshot().resources.find(v => v.id === first.id)?.cost, { jobs: 1, io: 1 })`.
 */
test('lease resize checks all held dimensions atomically and rejects new dimensions', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 4 }, io: { capacity: 4 } } });
  const first = await runtime.acquire(request('first', { jobs: 1, io: 1 }));
  const second = await runtime.acquire(request('second', { io: 2 }));
  assert.throws(() => first.resize({ jobs: 3, io: 3 }), { code: 'RESOURCE_CAPACITY' });
  assert.deepEqual(runtime.snapshot().resources.find(v => v.id === first.id)?.cost, { jobs: 1, io: 1 });
  assert.deepEqual(runtime.snapshot().budgets.map(v => v.used), [1, 3]);
  assert.throws(() => second.resize({ jobs: 1 }), { code: 'RESOURCE_INVALID' });
  for (const amount of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => first.resize({ jobs: amount }), { code: 'RESOURCE_INVALID' });
  first.resize({ jobs: 3, io: 2 });
  assert.deepEqual(runtime.snapshot().budgets.map(v => v.used), [3, 4]);
  first.release(); second.release(); runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shrinking a lease wakes queued work and zero-cost partitions retain their definition
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `first.resize`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.snapshot().budgets.find(v => v.key === 'partition:temporary')?.used, 5)`; `assert.ok(runtime.snapshot().budgets.some(v => v.key === 'partition:temporary'))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('shrinking a lease wakes queued work and zero-cost partitions retain their definition', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const first = await runtime.acquire({ ...request('first'), partitions: [{ key: 'temporary', limit: 10, amount: 10 }] });
  const waiting = runtime.acquire({ ...request('waiting'), partitions: [{ key: 'temporary', limit: 10, amount: 5 }] });
  first.resize({ jobs: 0, 'partition:temporary': 0 });
  const second = await waiting;
  assert.equal(runtime.snapshot().budgets.find(v => v.key === 'partition:temporary')?.used, 5);
  second.release();
  assert.ok(runtime.snapshot().budgets.some(v => v.key === 'partition:temporary'));
  await assert.rejects(runtime.acquire({ ...request('conflict'), partitions: [{ key: 'temporary', limit: 11 }] }), { code: 'RESOURCE_PARTITION_CONFLICT' });
  first.resize({ jobs: 1, 'partition:temporary': 10 });
  first.release();
  assert.ok(!runtime.snapshot().budgets.some(v => v.key === 'partition:temporary'));
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resize preserves control reserve while allowing reductions under control pressure
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `ordinary.resize`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => ordinary.resize({ jobs: 3 }), { code: 'RESOURCE_CAPACITY' })`; `assert.equal(runtime.snapshot().budgets[0].used, 3)`.
 */
test('resize preserves control reserve while allowing reductions under control pressure', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 4, reserved: 2 } } });
  const ordinary = await runtime.acquire(request('ordinary'));
  ordinary.resize({ jobs: 2 });
  assert.throws(() => ordinary.resize({ jobs: 3 }), { code: 'RESOURCE_CAPACITY' });
  const control = await runtime.acquire({ ...request('control'), lane: 'control' });
  control.resize({ jobs: 2 });
  ordinary.resize({ jobs: 1 });
  assert.equal(runtime.snapshot().budgets[0].used, 3);
  assert.throws(() => ordinary.resize({ jobs: 2 }), { code: 'RESOURCE_CAPACITY' });
  ordinary.release(); control.release(); runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cleanup-pending and released leases cannot change their reserved amounts
 * 协作入口 / Collaborators: `runtime.acquire`, `request`, `lease.cleanupPending`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => lease.resize({ jobs: 0 }), { code: 'RESOURCE_CLEANUP_PENDING' })`; `assert.equal(runtime.snapshot().budgets[0].used, 1)`.
 */
test('cleanup-pending and released leases cannot change their reserved amounts', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 2 } } });
  const lease = await runtime.acquire(request('pending'));
  lease.cleanupPending(new Error('physical close unconfirmed'));
  assert.throws(() => lease.resize({ jobs: 0 }), { code: 'RESOURCE_CLEANUP_PENDING' });
  assert.equal(runtime.snapshot().budgets[0].used, 1);
  lease.release();
  assert.throws(() => lease.resize({ jobs: 1 }), { code: 'RESOURCE_RELEASED' });
  runtime.close();
});
