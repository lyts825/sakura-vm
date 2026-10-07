/**
 * 模块职责：回归验证模块，围绕 `jobs-admission` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `jobs-admission`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: global jobs admission preserves control capacity and cancels queued work without executing it; nested siblings and grandchildren share one slot and preserve resource identity.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Jobs } from '../server/jobs.ts';
import { AppError } from '../shared/errors.ts';
import { hostRuntime, resourceContext } from '../server/host-runtime/index.ts';

const parent = await realpath(tmpdir()), directory = await mkdtemp(join(parent, 'sakura-job-admission-'));
after(async () => { const path = await realpath(directory); assert.equal(dirname(path), parent);
  assert.match(basename(path), /^sakura-job-admission-/); await rm(path, { recursive: true, force: true }); });
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
 * 检查边界 / Checked boundaries: `assert.ok(Date.now() < end, 'Jobs did not settle')`.
 */
async function eventually(check: /**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) { const end = Date.now() + 3000;
  while (!check()) { assert.ok(Date.now() < end, 'Jobs did not settle'); await delay(5); } }
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`hostRuntime.snapshot().budgets.find((budget) => budget.key === 'jobs')!.used`）。
 * Result: Return the branch-computed value (`hostRuntime.snapshot().budgets.find((budget) => budget.key === 'jobs')!.used`).
 * 协作入口 / Collaborators: `hostRuntime.snapshot().budgets.find`, `hostRuntime.snapshot`.
 */
const used = () => hostRuntime.snapshot().budgets.find((budget) => budget.key === 'jobs')!.used;

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: global jobs admission preserves control capacity and cancels queued work without executing it
 * 协作入口 / Collaborators: `gate`, `jobs.start`, `assert.equal`, `used`.
 * 检查边界 / Checked boundaries: `assert.equal(used(), 14)`; `assert.equal(queued.status, 'running')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('global jobs admission preserves control capacity and cancels queued work without executing it', async () => {
  const jobs = new Jobs(), entered = gate(), cleanup = gate(); let active = 0, executed = false;
  try {
    for (let i = 0; i < 14; i++) jobs.start('run-' + i, async (_log, signal) => {
      if (++active === 14) entered.resolve();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      await cleanup.promise;
    });
    await entered.promise; assert.equal(used(), 14);
    const queued = jobs.start('queued', async () => { executed = true; });
    await delay(10); assert.equal(queued.status, 'running'); assert.equal(queued.admission, 'queued');
    assert.ok(queued.queuedAt); assert.equal(queued.executionStartedAt, undefined);
    assert.throws(() => jobs.start('queued', async () => {}), { status: 409 });
    await jobs.track('control', async () => { assert.equal(used(), 15); }, { lane: 'control' });
    jobs.cancel('queued'); await jobs.wait('queued'); assert.equal(executed, false); assert.equal(queued.status, 'cancelled');
    const closing = jobs.close(); assert.equal(jobs.close(), closing);
    await delay(10); assert.equal(used(), 14); cleanup.resolve(); await closing; assert.equal(used(), 0);
  } finally { cleanup.resolve(); await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: nested siblings and grandchildren share one slot and preserve resource identity
 * 协作入口 / Collaborators: `jobs.track`, `assert.deepEqual`, `assert.equal`, `jobs.view`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(result, ['A', 'B'])`; `assert.deepEqual(events, ['a', 'grandchild', 'a-done', 'b'])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('nested siblings and grandchildren share one slot and preserve resource identity', async () => {
  const jobs = new Jobs(), events: string[] = []; let peak = 0;
  try {
    const result = await jobs.track('parent', async () => {
      const a = jobs.track('a', async () => {
        events.push('a'); peak = Math.max(peak, used());
        await jobs.track('grandchild', async () => {
          peak = Math.max(peak, used()); events.push('grandchild');
          assert.equal(resourceContext()?.vmId, 'vm-test');
        }, { vmId: 'vm-test' });
        await delay(5); events.push('a-done'); return 'A';
      });
      const b = jobs.track('b', async () => { events.push('b'); peak = Math.max(peak, used()); return 'B'; });
      return await Promise.all([a, b]);
    }, { vmId: 'vm-test' });
    assert.deepEqual(result, ['A', 'B']); assert.deepEqual(events, ['a', 'grandchild', 'a-done', 'b']); assert.equal(peak, 1);
    assert.equal(jobs.view('a')?.delegatedFrom, jobs.view('parent')?.id);
    assert.equal(jobs.view('b')?.resourceLeaseId, jobs.view('parent')?.resourceLeaseId);
    assert.equal(used(), 0);
  } finally { await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelling a queued sibling does not let later siblings overtake active work
 * 协作入口 / Collaborators: `gate`, `jobs.track`, `jobs.cancel`, `jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(events, [])`; `assert.equal(jobs.view('c')?.admission, 'queued')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('cancelling a queued sibling does not let later siblings overtake active work', async () => {
  const jobs = new Jobs(), entered = gate(), release = gate(), queued = gate(); const events: string[] = [];
  try {
    const parentTask = jobs.track('parent', async () => {
      const a = jobs.track('a', async () => { entered.resolve(); await release.promise; events.push('a'); });
      const b = jobs.track('b', async () => { events.push('b'); });
      const cancelled = assert.rejects(b, /取消/);
      const c = jobs.track('c', async () => { events.push('c'); });
      queued.resolve(); await Promise.all([a, cancelled, c]);
    });
    await queued.promise; await entered.promise; jobs.cancel('b'); await jobs.wait('b');
    assert.deepEqual(events, []); assert.equal(jobs.view('c')?.admission, 'queued');
    release.resolve(); await parentTask; assert.deepEqual(events, ['a', 'c']);
  } finally { release.resolve(); await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: parent cancellation waits for delegated cleanup before releasing its only slot
 * 协作入口 / Collaborators: `gate`, `jobs.track`, `assert.rejects`, `jobs.cancel`.
 * 检查边界 / Checked boundaries: `assert.rejects(running, /取消/)`; `assert.equal(used(), 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('parent cancellation waits for delegated cleanup before releasing its only slot', async () => {
  const jobs = new Jobs(), entered = gate(), cleanup = gate(); let cleaned = false;
  try {
    const running = jobs.track('parent', async () => {
      await jobs.track('child', async (_log, signal) => {
        entered.resolve(); await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        await cleanup.promise; cleaned = true;
      });
    });
    const rejected = assert.rejects(running, /取消/); await entered.promise;
    jobs.cancel('parent'); await delay(10); assert.equal(used(), 1); assert.equal(cleaned, false);
    cleanup.resolve(); await rejected; assert.equal(cleaned, true); assert.equal(used(), 0);
  } finally { cleanup.resolve(); await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: self waits, later-sibling waits and cross-parent cycles fail instead of deadlocking
 * 协作入口 / Collaborators: `assert.rejects`, `jobs.track`, `gate`, `Promise.all`.
 * 检查边界 / Checked boundaries: `assert.rejects(jobs.track('self', async () => { await jobs.wait('self'); }), { code: 'JOB_DEPENDENCY_CYCLE' })`; `assert.rejects(jobs.track('self-close', async () => { await jobs.close(); }), { code: 'JOB_DEPENDENCY_CYCLE' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('self waits, later-sibling waits and cross-parent cycles fail instead of deadlocking', async () => {
  const jobs = new Jobs();
  try {
    await assert.rejects(jobs.track('self', async () => { await jobs.wait('self'); }), { code: 'JOB_DEPENDENCY_CYCLE' });
    await assert.rejects(jobs.track('self-close', async () => { await jobs.close(); }), { code: 'JOB_DEPENDENCY_CYCLE' });
    await jobs.track('parent', async () => {
      const a = jobs.track('first', async () => {
        await assert.rejects(jobs.wait('second'), { code: 'JOB_DEPENDENCY_CYCLE' });
      });
      const b = jobs.track('second', async () => {}); await Promise.all([a, b]);
    });
    const readyA = gate(), readyB = gate(); let cycle = false;
    const a = jobs.track('root-a', async () => { readyA.resolve(); await readyB.promise; await jobs.wait('root-b'); });
    const b = jobs.track('root-b', async () => { readyB.resolve(); await readyA.promise;
      try { await jobs.wait('root-a'); } catch (error: any) { assert.equal(error.code, 'JOB_DEPENDENCY_CYCLE'); cycle = true; } });
    await Promise.all([a, b]); assert.equal(cycle, true); assert.equal(used(), 0);
  } finally { await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: synchronous root registration and delegated sibling queues are bounded before any work starts
 * 协作入口 / Collaborators: `jobs.start`, `assert.throws`, `Promise.all`, `Array.from`.
 * 检查边界 / Checked boundaries: `assert.throws(() => jobs.start('overflow', async () => {}), { code: 'JOB_QUEUE_FULL' })`; `assert.throws(() => jobs.start('control-overflow', async () => {}, { lane: 'control' }), { code: 'JOB_QUEUE_FULL' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('synchronous root registration and delegated sibling queues are bounded before any work starts', async () => {
  const jobs = new Jobs();
  try {
    for (let i = 0; i < 78; i++) jobs.start('root-' + i, async () => {});
    assert.throws(() => jobs.start('overflow', async () => {}), { code: 'JOB_QUEUE_FULL' });
    jobs.start('root-78', async () => {}, { lane: 'control' });
    jobs.start('root-79', async () => {}, { lane: 'control' });
    assert.throws(() => jobs.start('control-overflow', async () => {}, { lane: 'control' }), { code: 'JOB_QUEUE_FULL' });
    await Promise.all(Array.from({ length: 80 }, (_, i) => jobs.wait('root-' + i)));
    await jobs.track('parent', async () => {
      for (let i = 0; i < 64; i++) jobs.start('child-' + i, async () => {});
      assert.throws(() => jobs.start('child-overflow', async () => {}), { code: 'JOB_QUEUE_FULL' });
    });
    assert.equal(used(), 0);
  } finally { await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: process and storage cleanup failures survive cancellation and only their owning Jobs resolves markers
 * 协作入口 / Collaborators: `gate`, `jobs.track`, `assert.rejects`, `jobs.cancel`.
 * 检查边界 / Checked boundaries: `assert.rejects(task, { code, status: 503 })`; `assert.equal(view.admission, 'cleanup-pending')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('process and storage cleanup failures survive cancellation and only their owning Jobs resolves markers', async () => {
  const jobs = new Jobs(), foreign = new Jobs();
  try {
    for (const code of ['HOST_PROCESS_CLEANUP_PENDING', 'STORAGE_CLEANUP_PENDING']) {
      const entered = gate();
      const task = jobs.track(code, async (_log, signal) => {
        entered.resolve(); await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new AppError('Domain cleanup unconfirmed', 503, code);
      });
      const rejected = assert.rejects(task, { code, status: 503 }); await entered.promise; jobs.cancel(code); await rejected;
      const view = jobs.view(code)!; assert.equal(view.admission, 'cleanup-pending'); assert.ok(view.cleanupLeaseId);
      assert.equal(used(), 0);
      await assert.rejects(foreign.resolveCleanup(view.id!), { code: 'JOB_CLEANUP_NOT_FOUND' });
      assert.ok(hostRuntime.snapshot().resources.some((resource) => resource.id === view.cleanupLeaseId && resource.state === 'cleanup-pending'));
      await jobs.resolveCleanup(view.id!); assert.equal(view.admission, undefined); assert.ok(view.cleanupResolvedAt);
      assert.equal(hostRuntime.snapshot().resources.some((resource) => resource.id === view.cleanupLeaseId), false);
      assert.equal(view.status, 'error'); assert.equal(view.errorCode, code);
    }
  } finally { await jobs.close(); await foreign.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: restarted queued and cancelling histories become interrupted, and history errors remain observational
 * 协作入口 / Collaborators: `join`, `writeFile`, `JSON.stringify`, `['queued', 'cancelling'].map`.
 * 检查边界 / Checked boundaries: `assert.ok(restored.list().every((job) => job.status === 'interrupted' && job.admission === undefined))`; `assert.equal(executed, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('restarted queued and cancelling histories become interrupted, and history errors remain observational', async () => {
  const file = join(directory, 'restart.json');
  await writeFile(file, JSON.stringify(['queued', 'cancelling'].map((admission, i) => ({ id: String(i), key: String(i),
    status: 'running', admission, startedAt: new Date().toISOString(), log: '' }))));
  const restored = new Jobs('restart', directory);
  assert.ok(restored.list().every((job) => job.status === 'interrupted' && job.admission === undefined)); await restored.close();
  const blocked = join(directory, 'not-a-directory'); await writeFile(blocked, 'fixture');
  const jobs = new Jobs('observational', blocked); let executed = false;
  await jobs.track('run', async () => { executed = true; });
  assert.equal(executed, true); assert.ok(jobs.persistenceError); await jobs.close();
  assert.equal((JSON.parse(await readFile(file, 'utf8')) as any[]).every((job) => job.status === 'interrupted'), true);
});
