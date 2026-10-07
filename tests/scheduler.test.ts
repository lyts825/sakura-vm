/**
 * 模块职责：回归验证模块，围绕 `scheduler` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `scheduler`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: periodic work owns its budget independently of the registering job and actor; application drain stops new schedules and exposes cancellation until physical work finishes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Scheduler } from '../server/scheduler.ts';
import { Jobs } from '../server/jobs.ts';
import { hostRuntime, resourceContext, withResourceContext } from '../server/host-runtime/index.ts';
import { AppError } from '../shared/errors.ts';

/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
function gate() { let resolve!: /**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: check: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Date.now`, `check`, `assert.ok`, `delay`.
 * 检查边界 / Checked boundaries: `assert.ok(Date.now() < end, 'Scheduler did not settle')`.
 */
async function eventually(check: /**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) { const end = Date.now() + 2000;
  while (!check()) { assert.ok(Date.now() < end, 'Scheduler did not settle'); await delay(5); } }

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: periodic work owns its budget independently of the registering job and actor
 * 协作入口 / Collaborators: `gate`, `scheduler.register`, `withResourceContext`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(handle.snapshot().state, 'running')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('periodic work owns its budget independently of the registering job and actor', async () => {
  const scheduler = new Scheduler(), jobs = new Jobs(), entered = gate(), release = gate();
  let actor: string | undefined, owner: string | undefined;
  const handle = scheduler.register({ owner: 'plugin:periodic', label: 'Independent fixture', intervalMs: 60000,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: periodic work owns its budget independently of the registering job and actor
     * 状态影响 / State effects: `actor`, `owner`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `resourceContext`, `entered.resolve`.
     */
    run: async () => { actor = resourceContext()?.actorId; owner = resourceContext()?.owner; entered.resolve(); await release.promise; } });
  try {
    await withResourceContext({ actorId: 'registrant', vmId: 'old-vm' }, () => jobs.track('register', async () => {
      handle.trigger(); await entered.promise;
      assert.equal(actor, undefined); assert.equal(owner, 'plugin:periodic');
      assert.equal(hostRuntime.snapshot().budgets.find(budget => budget.key === 'jobs')?.used, 2);
      // The registering task can finish while the schedule remains active.
    }));
    assert.equal(handle.snapshot().state, 'running');
    release.resolve(); await scheduler.close(); await jobs.close();
  } finally { release.resolve(); await scheduler.close(); await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: application drain stops new schedules and exposes cancellation until physical work finishes
 * 协作入口 / Collaborators: `gate`, `scheduler.register`, `handle.trigger`, `scheduler.beginDrain`.
 * 检查边界 / Checked boundaries: `assert.equal(signal?.aborted, true)`; `assert.equal(handle.snapshot().state, 'cancelling')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('application drain stops new schedules and exposes cancellation until physical work finishes', async () => {
  const scheduler = new Scheduler(), entered = gate(), release = gate();
  let signal: AbortSignal | undefined;
  const handle = scheduler.register({ owner: 'test:drain', label: 'Drain fixture', intervalMs: 60000,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: context。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: application drain stops new schedules and exposes cancellation until physical work finishes
     * 状态影响 / State effects: `signal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `entered.resolve`.
     */
    run: async (context) => { signal = context.signal; entered.resolve(); await release.promise; } });
  try {
    handle.trigger(); await entered.promise;
    scheduler.beginDrain();
    assert.equal(signal?.aborted, true);
    assert.equal(handle.snapshot().state, 'cancelling');
    assert.equal(handle.trigger(), false);
    assert.throws(() => scheduler.register({ owner: 'test:late', label: 'Late', intervalMs: 10, /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: application drain stops new schedules and exposes cancellation until physical work finishes
     */
    run: async () => {} }),
      { code: 'SCHEDULER_CLOSED' });
    let closed = false;
    const closing = scheduler.close().then(() => { closed = true; });
    await delay(10); assert.equal(closed, false);
    release.resolve(); await closing;
    assert.deepEqual(scheduler.snapshot(), []);
  } finally { release.resolve(); await scheduler.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: overlapping triggers coalesce into one followup while skip never overlaps
 * 协作入口 / Collaborators: `gate`, `scheduler.register`, `handle.trigger`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(handle.trigger(), true)`; `assert.equal(handle.snapshot().coalesced, 20)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('overlapping triggers coalesce into one followup while skip never overlaps', async () => {
  const scheduler = new Scheduler(), entered = gate(), release = gate(); let runs = 0, active = 0, peak = 0;
  const handle = scheduler.register({ owner: 'test:coalesce', label: 'Coalesced fixture', intervalMs: 60_000,
    overlap: 'coalesce', /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: overlapping triggers coalesce into one followup while skip never overlaps
     * 状态影响 / State effects: `peak`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `Math.max`, `entered.resolve`.
     */
    run: async () => {
      runs++; peak = Math.max(peak, ++active); if (runs === 1) { entered.resolve(); await release.promise; } active--;
    } });
  try {
    handle.trigger(); await entered.promise;
    for (let i = 0; i < 20; i++) assert.equal(handle.trigger(), true);
    assert.equal(handle.snapshot().coalesced, 20); release.resolve();
    await eventually(() => runs === 2 && handle.snapshot().state === 'scheduled'); assert.equal(peak, 1);
    const hold = gate(), started = gate();
    const skipped = scheduler.register({ owner: 'test:skip', label: 'Skipped fixture', intervalMs: 60_000,
      overlap: 'skip', /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: overlapping triggers coalesce into one followup while skip never overlaps
       * 协作入口 / Collaborators: `started.resolve`.
       */
      run: async () => { started.resolve(); await hold.promise; } });
    skipped.trigger(); await started.promise; assert.equal(skipped.trigger(), false); assert.equal(skipped.snapshot().skipped, 1);
    hold.resolve(); await skipped.close();
  } finally { release.resolve(); await scheduler.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: timeout aborts cooperatively, retains the slot during cleanup, and close is idempotent
 * 协作入口 / Collaborators: `gate`, `scheduler.register`, `handle.trigger`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(handle.snapshot().state, 'cancelling')`; `assert.ok(handle.snapshot().timedOutAt)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('timeout aborts cooperatively, retains the slot during cleanup, and close is idempotent', async () => {
  const scheduler = new Scheduler(), entered = gate(), aborted = gate(), cleanup = gate();
  const handle = scheduler.register({ owner: 'test:timeout', label: 'Timeout fixture', intervalMs: 60_000, timeoutMs: 20,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: { signal }。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: timeout aborts cooperatively, retains the slot during cleanup, and close is idempotent
     * 协作入口 / Collaborators: `entered.resolve`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(signal.reason.code, 'SCHEDULE_TIMEOUT')`.
     */
    run: async ({ signal }) => {
      entered.resolve(); await new Promise<void>((resolve) => signal.addEventListener('abort', () => { aborted.resolve(); resolve(); }, { once: true }));
      assert.equal(signal.reason.code, 'SCHEDULE_TIMEOUT'); await cleanup.promise;
    } });
  try {
    handle.trigger(); await entered.promise; await aborted.promise;
    assert.equal(handle.snapshot().state, 'cancelling'); assert.ok(handle.snapshot().timedOutAt);
    assert.equal(hostRuntime.snapshot().budgets.find((budget) => budget.key === 'jobs')?.used, 1);
    let closed = false; const closing = scheduler.close(); assert.equal(scheduler.close(), closing);
    void closing.then(() => { closed = true; }); await delay(10); assert.equal(closed, false);
    cleanup.resolve(); await closing; assert.equal(closed, true); assert.deepEqual(scheduler.snapshot(), []);
    assert.equal(handle.trigger(), false);
  } finally { cleanup.resolve(); await scheduler.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failure backoff delays a coalesced retry and success resets diagnostics
 * 协作入口 / Collaborators: `scheduler.register`, `handle.trigger`, `eventually`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(handle.snapshot().lastError, 'fixture failure')`; `assert.equal(runs, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('failure backoff delays a coalesced retry and success resets diagnostics', async () => {
  const scheduler = new Scheduler(); let runs = 0;
  const handle = scheduler.register({ owner: 'test:backoff', label: 'Backoff fixture', intervalMs: 10,
    overlap: 'coalesce', backoff: { initialMs: 80, maxMs: 160 }, /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: failure backoff delays a coalesced retry and success resets diagnostics
     * 失败 / Failure: `new Error('fixture failure')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    run: async () => {
      if (++runs === 1) throw new Error('fixture failure');
    } });
  try {
    handle.trigger(); await eventually(() => handle.snapshot().state === 'backoff');
    assert.equal(handle.snapshot().lastError, 'fixture failure'); handle.trigger();
    await delay(30); assert.equal(runs, 1);
    await eventually(() => runs >= 2); await eventually(() => handle.snapshot().failures === 0);
    assert.equal(handle.snapshot().lastError, undefined);
  } finally { await scheduler.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: late wakeups skip or run at most one catchup instead of replaying every missed tick
 * 协作入口 / Collaborators: `scheduler.register`, `performance.now`, `delay`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(skipped, 0)`; `assert.equal(caught, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('late wakeups skip or run at most one catchup instead of replaying every missed tick', async () => {
  const scheduler = new Scheduler(); let skipped = 0, caught = 0;
  scheduler.register({ owner: 'test:missed-skip', label: 'Skip missed ticks', intervalMs: 10, catchUp: 'skip',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: late wakeups skip or run at most one catchup instead of replaying every missed tick
     */
    run: async () => { skipped++; } });
  scheduler.register({ owner: 'test:missed-once', label: 'Coalesce missed ticks', intervalMs: 10, catchUp: 'once',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: late wakeups skip or run at most one catchup instead of replaying every missed tick
     */
    run: async () => { caught++; } });
  try {
    const until = performance.now() + 65; while (performance.now() < until) { /* simulate a suspended event loop */ }
    await delay(1);
    assert.equal(skipped, 0); assert.equal(caught, 1);
    assert.ok(scheduler.snapshot().every((view) => view.skipped >= 5));
  } finally { await scheduler.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scheduled work delegates nested Jobs without consuming a second execution slot
 * 协作入口 / Collaborators: `gate`, `scheduler.register`, `handle.trigger`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(jobs.view('child')?.delegatedFrom)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('scheduled work delegates nested Jobs without consuming a second execution slot', async () => {
  const scheduler = new Scheduler(), jobs = new Jobs(), complete = gate();
  const handle = scheduler.register({ owner: 'test:nested-schedule', label: 'Nested fixture', intervalMs: 60_000,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: scheduled work delegates nested Jobs without consuming a second execution slot
     * 协作入口 / Collaborators: `jobs.track`, `complete.resolve`.
     */
    run: async () => { await jobs.track('child', async () => {
      assert.equal(hostRuntime.snapshot().budgets.find((budget) => budget.key === 'jobs')?.used, 1);
    }); complete.resolve(); } });
  try { handle.trigger(); await complete.promise; assert.ok(jobs.view('child')?.delegatedFrom); }
  finally { await scheduler.close(); await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scheduler shutdown also waits for registrations already being closed
 * 协作入口 / Collaborators: `gate`, `scheduler.register`, `handle.trigger`, `handle.close`.
 * 检查边界 / Checked boundaries: `assert.equal(closed, false)`; `assert.equal(closed, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('scheduler shutdown also waits for registrations already being closed', async () => {
  const scheduler = new Scheduler(), entered = gate(), release = gate();
  const handle = scheduler.register({ owner: 'test:closing', label: 'Closing fixture', intervalMs: 60_000,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: scheduler shutdown also waits for registrations already being closed
     * 协作入口 / Collaborators: `entered.resolve`.
     */
    run: async () => { entered.resolve(); await release.promise; } });
  try {
    handle.trigger(); await entered.promise;
    const handleClose = handle.close(); let closed = false;
    const closing = scheduler.close(); void closing.then(() => { closed = true; });
    await delay(10); assert.equal(closed, false);
    release.resolve(); await Promise.all([handleClose, closing]); assert.equal(closed, true);
  } finally { release.resolve(); await scheduler.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: timed-out cleanup failures retain scheduler registration until explicit domain recovery and a close retry
 * 协作入口 / Collaborators: `gate`, `scheduler.register`, `handle.trigger`, `eventually`.
 * 检查边界 / Checked boundaries: `assert.equal(handle.snapshot().lastError, 'Underlying process cleanup unconfirmed')`; `assert.equal(handle.trigger(), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('timed-out cleanup failures retain scheduler registration until explicit domain recovery and a close retry', async () => {
  const scheduler = new Scheduler(), entered = gate();
  const handle = scheduler.register({ owner: 'test:cleanup-failure', label: 'Pending cleanup fixture', intervalMs: 60_000, timeoutMs: 10,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: { signal }。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: timed-out cleanup failures retain scheduler registration until explicit domain recovery and a close retry
     * 失败 / Failure: `new AppError('Underlying process cleanup unconfirmed', 503, 'HOST_PROCESS_CLEANUP_PENDING')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `entered.resolve`.
     */
    run: async ({ signal }) => {
      entered.resolve(); await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new AppError('Underlying process cleanup unconfirmed', 503, 'HOST_PROCESS_CLEANUP_PENDING');
    } });
  handle.trigger(); await entered.promise; await eventually(() => handle.snapshot().state === 'cleanup-pending');
  assert.equal(handle.snapshot().lastError, 'Underlying process cleanup unconfirmed');
  assert.equal(handle.trigger(), false);
  await assert.rejects(scheduler.close(), { code: 'HOST_PROCESS_CLEANUP_PENDING' });
  assert.equal(scheduler.snapshot().length, 1);
  assert.ok(hostRuntime.snapshot().resources.some((resource) => resource.kind === 'schedule' &&
    resource.owner === 'test:cleanup-failure' && resource.state === 'cleanup-pending'));
  await handle.resolveCleanup(handle.snapshot().jobId!);
  await scheduler.close(); assert.deepEqual(scheduler.snapshot(), []);
  assert.equal(hostRuntime.snapshot().resources.some((resource) => resource.owner === 'test:cleanup-failure'), false);
});
