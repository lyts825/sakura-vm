/**
 * 模块职责：回归验证模块，围绕 `operation-admission` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `operation-admission`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: queued resources revalidate their original operation and release every dimension on revocation; cancellation during asynchronous authorization returns the granted resource without executing work.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../shared/errors.ts';
import { HostRuntime, hostRuntime } from '../server/host-runtime/index.ts';
import { Jobs } from '../server/jobs.ts';
import { captureOperationCheck, withOperationCheck } from '../server/operation-context.ts';

const request = { owner: 'test:operation', kind: 'test', label: 'operation', cost: { jobs: 1 } };
/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
function gate() {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new AppError('Permission revoked', 403, 'TEST_REVOKED')`）。
 * Result: Return the branch-computed value (`new AppError('Permission revoked', 403, 'TEST_REVOKED')`).
 */
const denied = () => new AppError('Permission revoked', 403, 'TEST_REVOKED');

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queued resources revalidate their original operation and release every dimension on revocation
 * 状态影响 / State effects: `allowed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `runtime.acquire`, `withOperationCheck`, `assert.rejects`, `active.release`.
 * 检查边界 / Checked boundaries: `assert.rejects(waiting, { code: 'TEST_REVOKED' })`; `assert.equal(runtime.snapshot().resources.length, 0)`.
 */
test('queued resources revalidate their original operation and release every dimension on revocation', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const active = await runtime.acquire(request);
  let allowed = true;
  const waiting = withOperationCheck(async () => { if (!allowed) throw denied(); }, () =>
    runtime.acquire({ ...request, partitions: [{ key: 'operation', limit: 1 }] }));
  const rejected = assert.rejects(waiting, { code: 'TEST_REVOKED' });
  allowed = false;
  active.release();
  await rejected;
  assert.equal(runtime.snapshot().resources.length, 0);
  assert.equal(runtime.snapshot().budgets.length, 1);
  assert.equal(runtime.snapshot().budgets[0].used, 0);
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation during asynchronous authorization returns the granted resource without executing work
 * 协作入口 / Collaborators: `gate`, `withOperationCheck`, `assert.rejects`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, { name: 'AbortError' })`; `assert.equal(runtime.snapshot().budgets[0].used, 1)`.
 */
test('cancellation during asynchronous authorization returns the granted resource without executing work', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const entered = gate(), release = gate(), abort = new AbortController();
  const pending = withOperationCheck(async () => { entered.resolve(); await release.promise; }, () =>
    runtime.acquire({ ...request, signal: abort.signal }));
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise;
  assert.equal(runtime.snapshot().budgets[0].used, 1);
  abort.abort(); release.resolve(); await rejected;
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: permission checks do not recursively inherit themselves, and trusted control cleanup remains available
 * 协作入口 / Collaborators: `withOperationCheck`, `assert.equal`, `lease.release`, `control.release`.
 * 检查边界 / Checked boundaries: `assert.equal(checks, 1)`.
 */
test('permission checks do not recursively inherit themselves, and trusted control cleanup remains available', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 2 } } });
  let checks = 0;
  const lease = await withOperationCheck(async () => {
    ++checks;
    (await runtime.acquire(request)).release();
  }, () => runtime.acquire(request));
  assert.equal(checks, 1); lease.release();
  const control = await withOperationCheck(async () => { throw denied(); }, () =>
    runtime.acquire({ ...request, lane: 'control' }));
  control.release(); runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: nested job siblings revalidate after their delegated queue without releasing the parent slot
 * 状态影响 / State effects: `allowed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `gate`, `jobs.track`, `release.resolve`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(ran, false)`; `assert.equal(jobs.view('second')?.executionStartedAt, undefined)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('nested job siblings revalidate after their delegated queue without releasing the parent slot', async () => {
  const jobs = new Jobs(), entered = gate(), release = gate(), queued = gate();
  let allowed = true, ran = false;
  try {
    const parent = jobs.track('parent', async () => {
      const first = jobs.track('first', async () => { entered.resolve(); await release.promise; });
      const second = withOperationCheck(async () => { if (!allowed) throw denied(); }, () =>
        jobs.track('second', async () => { ran = true; }));
      const rejected = assert.rejects(second, { code: 'TEST_REVOKED' });
      queued.resolve(); await first; await rejected;
      assert.equal(hostRuntime.snapshot().budgets.find((b) => b.key === 'jobs')?.used, 1);
    });
    await queued.promise; await entered.promise;
    allowed = false; release.resolve(); await parent;
    assert.equal(ran, false);
    assert.equal(jobs.view('second')?.executionStartedAt, undefined);
    assert.equal(hostRuntime.snapshot().budgets.find((b) => b.key === 'jobs')?.used, 0);
  } finally { release.resolve(); await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: root jobs reject revoked authority while trusted cleanup and detached schedules have independent lifetimes
 * 协作入口 / Collaborators: `withOperationCheck`, `assert.equal`, `hostRuntime.snapshot().budgets.find`, `hostRuntime.snapshot`.
 * 检查边界 / Checked boundaries: `assert.equal(checks, 1)`; `assert.equal(ran, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('root jobs reject revoked authority while trusted cleanup and detached schedules have independent lifetimes', async () => {
  const jobs = new Jobs(); let checks = 0, ran = false;
  try {
    await withOperationCheck(async () => { ++checks; throw denied(); }, async () => {
      await assert.rejects(jobs.track('revoked', async () => { ran = true; }), { code: 'TEST_REVOKED' });
      await jobs.track('cleanup', async () => {}, { lane: 'control' });
      await Jobs.detached(() => jobs.track('schedule', async () => { await captureOperationCheck()(); }));
    });
    assert.equal(checks, 1);
    assert.equal(ran, false);
    assert.equal(hostRuntime.snapshot().budgets.find((b) => b.key === 'jobs')?.used, 0);
  } finally { await jobs.close(); }
});
