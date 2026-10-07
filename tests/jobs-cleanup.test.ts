/**
 * 模块职责：回归验证模块，围绕 `jobs-cleanup` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `jobs-cleanup`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: shutdown waits for cleanup and preserves its failure instead of a cancelled result; ordinary cancellation still records a cancelled result after successful cleanup.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Jobs } from '../server/jobs.ts';
import { AppError } from '../server/model.ts';
import { sandboxExecutionSchema } from '../shared/sandbox.ts';

const parent = await realpath(tmpdir());
const root = await mkdtemp(join(parent, 'sakura-jobs-cleanup-'));
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), parent);
  assert.match(basename(owned), /^sakura-jobs-cleanup-/);
  await rm(owned, { recursive: true, force: true });
});

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
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const code of [
  'GUEST_TASK_CLEANUP_FAILED', 'SERVICE_CLEANUP_FAILED',
  'PROJECT_MAIN_CLEANUP_FAILED', 'PROJECT_SSH_CLEANUP_FAILED',
  'PROJECT_IDENTITY_CLEANUP_FAILED',
  'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED',
  'PROJECT_REPOSITORY_CLEANUP_FAILED',
  'RUNTIME_INSTALL_CLEANUP_FAILED',
  'BROWSER_IDE_CLEANUP_FAILED',
  'NOTEBOOK_CLEANUP_FAILED', 'NOTEBOOK_PREPARE_CLEANUP_FAILED',
  'DESKTOP_CLEANUP_FAILED', 'LINUX_CLIPBOARD_CLEANUP_FAILED',
]) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `code.toLowerCase`, `gate`, `sandboxExecutionSchema.parse`, `jobs.start`.
   * 检查边界 / Checked boundaries: `assert.equal(view.status, 'error')`; `assert.equal(view.errorCode, code)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`cancelled ${code} cleanup remains a durable failure after restart`, async () => {
    const scope = code.toLowerCase(), jobs = new Jobs(scope, root), entered = gate();
    const execution = sandboxExecutionSchema.parse({ command: 'owned-test', cwd: '/workspace',
      timeoutSeconds: 30, requestedArtifacts: [], artifacts: [], timings: {}, outcome: 'cancelled' });
    const view = jobs.start('owned', async (log, signal) => {
      const aborted = new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
      entered.resolve();
      await aborted;
      log('原运行归属保留，清理重试均未确认\n');
      throw new AppError('清理未确认，原运行记录保留', 503, code);
    }, { execution });
    await entered.promise;
    jobs.cancel(view.id!);
    await jobs.wait('owned');
    assert.equal(view.status, 'error');
    assert.equal(view.errorCode, code);
    assert.equal(view.error, '清理未确认，原运行记录保留');
    assert.equal(view.phase, view.error);
    assert.equal(view.execution?.outcome, 'failed');
    await jobs.close();
    const restored = new Jobs(scope, root);
    assert.equal(restored.get(view.id!)?.status, 'error');
    assert.equal(restored.get(view.id!)?.errorCode, code);
    assert.equal(restored.get(view.id!)?.execution?.outcome, 'failed');
    await restored.close();
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shutdown waits for cleanup and preserves its failure instead of a cancelled result
 * 协作入口 / Collaborators: `gate`, `jobs.start`, `jobs.close`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(stored[0].status, 'error')`; `assert.equal(stored[0].errorCode, 'GUEST_TASK_CLEANUP_FAILED')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('shutdown waits for cleanup and preserves its failure instead of a cancelled result', async () => {
  const jobs = new Jobs('shutdown-cleanup', root), entered = gate();
  const view = jobs.start('owned', async (_log, signal) => {
    const aborted = new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
    entered.resolve();
    await aborted;
    throw new AppError('关闭后的任务域清理仍未确认', 503, 'GUEST_TASK_CLEANUP_FAILED');
  });
  await entered.promise;
  await jobs.close();
  const stored = JSON.parse(await readFile(join(root, 'shutdown-cleanup.json'), 'utf8'));
  assert.equal(stored[0].status, 'error');
  assert.equal(stored[0].errorCode, 'GUEST_TASK_CLEANUP_FAILED');
  assert.equal(view.error, '关闭后的任务域清理仍未确认');
});

for (const code of ['PROJECT_MAIN_CLEANUP_FAILED', 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED', 'PROJECT_REPOSITORY_CLEANUP_FAILED',
  'BROWSER_IDE_CLEANUP_FAILED', 'NOTEBOOK_CLEANUP_FAILED', 'NOTEBOOK_PREPARE_CLEANUP_FAILED',
  'DESKTOP_CLEANUP_FAILED', 'LINUX_CLIPBOARD_CLEANUP_FAILED']) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `code.toLowerCase`, `gate`, `jobs.track`, `assert.rejects`.
   * 检查边界 / Checked boundaries: `assert.rejects(pending, { status: 503, code, message: '项目清理未确认' })`; `assert.equal(jobs.view('owned')?.status, 'error')`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`tracked cancellation returns the original ${code} status, code and message`, async () => {
    const jobs = new Jobs('tracked-' + code.toLowerCase(), root), entered = gate(), abort = new AbortController();
    const pending = jobs.track('owned', async (_log, signal) => {
      const aborted = new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
      entered.resolve();
      await aborted;
      throw new AppError('项目清理未确认', 503, code);
    }, {}, abort.signal);
    const rejected = assert.rejects(pending, { status: 503, code,
      message: '项目清理未确认' });
    await entered.promise;
    abort.abort();
    await rejected;
    assert.equal(jobs.view('owned')?.status, 'error');
    await jobs.close();
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ordinary cancellation still records a cancelled result after successful cleanup
 * 协作入口 / Collaborators: `gate`, `jobs.track`, `assert.rejects`, `jobs.cancel`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, { status: 409, message: '操作已取消' })`; `assert.equal(cleaned, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('ordinary cancellation still records a cancelled result after successful cleanup', async () => {
  const jobs = new Jobs('ordinary-cancel', root), entered = gate();
  let cleaned = false;
  const pending = jobs.track('owned', async (_log, signal) => {
    const aborted = new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
    entered.resolve();
    await aborted;
    cleaned = true;
  });
  const rejected = assert.rejects(pending, { status: 409, message: '操作已取消' });
  await entered.promise;
  jobs.cancel('owned');
  await rejected;
  assert.equal(cleaned, true);
  assert.equal(jobs.view('owned')?.status, 'cancelled');
  assert.equal(jobs.view('owned')?.errorCode, undefined);
  await jobs.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: tracked application failures retain their actual status and code without cancellation
 * 协作入口 / Collaborators: `assert.rejects`, `jobs.track`, `jobs.close`.
 * 检查边界 / Checked boundaries: `assert.rejects(jobs.track('owned', async () => { throw new AppError('项目运行身份已变化', 409, 'PROJECT_MAIN_SCOPE_CHANGED'); }), { status:…`.
 */
test('tracked application failures retain their actual status and code without cancellation', async () => {
  const jobs = new Jobs('tracked-application-error', root);
  await assert.rejects(jobs.track('owned', async () => {
    throw new AppError('项目运行身份已变化', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
  }), { status: 409, code: 'PROJECT_MAIN_SCOPE_CHANGED', message: '项目运行身份已变化' });
  await jobs.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cleanup failure raised by the execution wrapper also returns the cleanup status
 * 状态影响 / State effects: `Jobs.instrument`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `assert.rejects`, `jobs.track`, `assert.equal`, `jobs.view`.
 * 检查边界 / Checked boundaries: `assert.rejects(jobs.track('owned', async () => 'completed command'), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED', message: '执…`; `assert.equal(jobs.view('owned')?.status, 'error')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('cleanup failure raised by the execution wrapper also returns the cleanup status', async () => {
  const jobs = new Jobs('wrapper-cleanup', root), previous = Jobs.instrument;
  Jobs.instrument = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: _view; work。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: cleanup failure raised by the execution wrapper also returns the cleanup status
   * 失败 / Failure: `new AppError('执行包装器清理未确认', 503, 'GUEST_TASK_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `work`.
   */
  async (_view, work) => {
    await work();
    throw new AppError('执行包装器清理未确认', 503, 'GUEST_TASK_CLEANUP_FAILED');
  };
  try {
    await assert.rejects(jobs.track('owned', async () => 'completed command'), {
      status: 503, code: 'GUEST_TASK_CLEANUP_FAILED', message: '执行包装器清理未确认',
    });
    assert.equal(jobs.view('owned')?.status, 'error');
  } finally { Jobs.instrument = previous; await jobs.close(); }
});
