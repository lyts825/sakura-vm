/**
 * 模块职责：回归验证模块，围绕 `log-retention` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `log-retention`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: log retention enforces age and global UTF-8 bytes while protecting active and invalid-time evidence; saved policy resumes after restart, pauses for migration, and clears no results or task metadata.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Jobs, type JobView } from '../server/jobs.ts';
import { LogRetention, logRetentionPolicy, planLogRetention } from '../server/log-retention.ts';

const now = Date.now(),
  day = 86400000;
const policy = { enabled: true, days: 7, maxMiB: 1 };
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: text: string。
 * 结果：返回分支计算值（`createHash('sha256').update(text).digest('hex')`）。
 * Result: Return the branch-computed value (`createHash('sha256').update(text).digest('hex')`).
 * 协作入口 / Collaborators: `createHash('sha256').update(text).digest`, `createHash('sha256').update`, `createHash`.
 */
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: age: number; log = 'sensitive old output'。
 * 结果：返回受控对象，公开字段包括 `id, key, status, startedAt, finishedAt, log, title`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, key, status, startedAt, finishedAt, log, title`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `new Date(now - age * day - 1000).toISOString`, `new Date(now - age * day).toISOString`.
 */
function job(age: number, log = 'sensitive old output'): JobView {
  return {
    id: randomUUID(),
    key: randomUUID(),
    status: 'done',
    startedAt: new Date(now - age * day - 1000).toISOString(),
    finishedAt: new Date(now - age * day).toISOString(),
    log,
    title: 'Retained task identity',
  };
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: test.TestContext; rows: JobView[]; name = 'history'。
 * 结果：返回受控对象，公开字段包括 `folder, store, file`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `folder, store, file`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `writeFile`.
 */
async function setup(t: test.TestContext, rows: JobView[], name = 'history') {
  const folder = await mkdtemp(join(tmpdir(), 'sakura-log-retention-'));
  await writeFile(join(folder, name + '.json'), JSON.stringify(rows));
  const store = new Jobs(name, folder);
  t.after(async () => {
    await store.close();
    await rm(folder, { recursive: true, force: true });
  });
  return { folder, store, file: join(folder, 'policy.json') };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: log retention enforces age and global UTF-8 bytes while protecting active and invalid-time evidence
 * 协作入口 / Collaborators: `job`, `'中'.repeat`, `'x'.repeat`, `setup`.
 * 检查边界 / Checked boundaries: `assert.equal(plan.summary.completedBytes, Buffer.byteLength(old.log) + 1200000)`; `assert.deepEqual( plan.removals.map((item) => item.job.id), [old.id, oldest.id], )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('log retention enforces age and global UTF-8 bytes while protecting active and invalid-time evidence', async (t) => {
  const old = job(10),
    oldest = job(3, '中'.repeat(200000)),
    newest = job(1, 'x'.repeat(600000)),
    future = job(-1);
  const first = await setup(t, [old, oldest]),
    second = await setup(t, [newest, future]);
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const active = first.store.start('active', async (log) => {
    log('active secret output');
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  t.after(() => release());
  await ready;
  const plan = planLogRetention([first.store, second.store], policy, now);
  assert.equal(plan.summary.completedBytes, Buffer.byteLength(old.log) + 1200000);
  assert.deepEqual(
    plan.removals.map((item) => item.job.id),
    [old.id, oldest.id],
  );
  assert.equal(plan.summary.expiredLogs, 1);
  assert.equal(plan.summary.capacityLogs, 1);
  assert.equal(plan.summary.protectedLogs, 2);
  assert.equal(plan.summary.remainingBytes, 600000);
  const manager = new LogRetention(
    () => [first.store, second.store],
    first.file,
    undefined,
    () => now,
  );
  await manager.init(false);
  t.after(() => manager.close());
  assert.equal(manager.view().policy.enabled, false);
  assert.ok(!JSON.stringify(manager.preview(policy)).includes('sensitive'));
  const preview = manager.preview(policy);
  await manager.save(policy, preview.token);
  assert.equal(first.store.get(old.id!)!.log, '');
  assert.equal(first.store.get(oldest.id!)!.logPruned?.bytes, 600000);
  assert.equal(first.store.get(active.id!)!.log, 'active secret output');
  assert.equal(second.store.get(newest.id!)!.log.length, 600000);
  assert.equal(second.store.get(future.id!)!.log, future.log);
  release();
  await first.store.wait('active');
  assert.equal(manager.view().lastRun?.removedLogs, 2);
  const persisted = JSON.parse(await readFile(join(first.folder, 'history.json'), 'utf8'));
  assert.equal(persisted[0].title, old.title);
  assert.equal(persisted[0].log, '');
  assert.ok(persisted[0].logPruned.at);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: saved policy resumes after restart, pauses for migration, and clears no results or task metadata
 * 状态影响 / State effects: `done.finishedAt`, `later.finishedAt`, `blocked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `data.store.start`, `data.store.wait`, `new Date(now - 20 * day).toISOString`.
 * 检查边界 / Checked boundaries: `assert.equal(active, 0)`; `assert.equal(saved.lastRun?.removedLogs, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('saved policy resumes after restart, pauses for migration, and clears no results or task metadata', async (t) => {
  const data = await setup(t, []);
  const done = data.store.start('output', async (log, _signal, _update, result) => {
    log('expire me');
    await result({ artifact: 'RESULT_RETAINS_ITS_OWN_POLICY' });
  });
  await data.store.wait('output');
  done.finishedAt = new Date(now - 20 * day).toISOString();
  let blocked = false,
    active = 0;
  const manager = new LogRetention(
    () => [data.store],
    data.file,
    () => blocked,
    () => now,
    (delta) => {
      active += delta;
    },
  );
  await manager.init(false);
  const saved = await manager.save(policy, manager.preview(policy).token);
  assert.equal(active, 0);
  assert.equal(saved.lastRun?.removedLogs, 1);
  assert.deepEqual(await data.store.result(done.id!), { artifact: 'RESULT_RETAINS_ITS_OWN_POLICY' });
  assert.equal(data.store.get(done.id!)?.status, 'done');
  await manager.close();
  const reopened = new LogRetention(
    () => [data.store],
    data.file,
    () => blocked,
    () => now,
  );
  t.after(() => reopened.close());
  await reopened.init(false);
  assert.equal(reopened.view().policy.enabled, true);
  const later = data.store.start('later', async (log) => {
    log('later output');
  });
  await data.store.wait('later');
  later.finishedAt = new Date(now - 20 * day).toISOString();
  blocked = true;
  await reopened.sweep();
  assert.equal(later.log, 'later output');
  await assert.rejects(reopened.save(policy, reopened.preview(policy).token), /迁移/);
  blocked = false;
  await reopened.sweep();
  assert.equal(later.log, '');
  await reopened.close();
  await assert.rejects(reopened.sweep(), /关闭/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stale previews, changed policies and changed log bodies cannot authorize a different cleanup
 * 状态影响 / State effects: `actual.log`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `job`, `setup`, `t.after`, `manager.init`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.save(policy, preview.token), /重新预览/)`; `assert.equal(manager.view().policy.enabled, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('stale previews, changed policies and changed log bodies cannot authorize a different cleanup', async (t) => {
  const old = job(20),
    data = await setup(t, [old]);
  const manager = new LogRetention(
    () => [data.store],
    data.file,
    undefined,
    () => now,
  );
  t.after(() => manager.close());
  await manager.init(false);
  const preview = manager.preview(policy);
  const actual = data.store.get(old.id!)!;
  actual.log = 'newer evidence';
  await assert.rejects(manager.save(policy, preview.token), /重新预览/);
  assert.equal(manager.view().policy.enabled, false);
  assert.equal(actual.log, 'newer evidence');
  const keep = { ...policy, enabled: false };
  const pending = manager.preview(keep);
  await manager.save({ ...keep, days: 90 }, manager.preview({ ...keep, days: 90 }).token);
  await assert.rejects(manager.save(keep, pending.token), /重新预览/);
  const cleared = await data.store.clearCompletedLogs(
    [{ id: old.id!, signature: hash(old.log) }],
    new Date(now).toISOString(),
  );
  assert.equal(cleared.removedLogs, 0);
  assert.equal(actual.log, 'newer evidence');
  for (const bad of [
    { ...policy, days: 0 },
    { ...policy, maxMiB: -1 },
    { ...policy, extra: true },
  ])
    assert.equal(logRetentionPolicy.safeParse(bad).success, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: history persistence failure restores the in-memory log and exposes incomplete cleanup for retry
 * 状态影响 / State effects: `data.store.flush`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `job`, `setup`, `data.store.flush.bind`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.save(policy, manager.preview(policy).token), /未全部完成/)`; `assert.equal(data.store.get(old.id!)?.log, old.log)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('history persistence failure restores the in-memory log and exposes incomplete cleanup for retry', async (t) => {
  const old = job(20),
    data = await setup(t, [old]);
  const original = data.store.flush.bind(data.store);
  data.store.flush = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: history persistence failure restores the in-memory log and exposes incomplete cleanup for retry
   * 状态影响 / State effects: `data.store.persistenceError`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  async () => {
    data.store.persistenceError = 'simulated disk error';
  };
  const manager = new LogRetention(
    () => [data.store],
    data.file,
    undefined,
    () => now,
  );
  t.after(() => manager.close());
  await manager.init(false);
  await assert.rejects(manager.save(policy, manager.preview(policy).token), /未全部完成/);
  assert.equal(data.store.get(old.id!)?.log, old.log);
  assert.ok(manager.view().warning);
  data.store.flush = original;
  await manager.sweep();
  assert.equal(data.store.get(old.id!)?.log, '');
  assert.equal(manager.view().warning, undefined);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid persisted settings fail closed and a failed policy write never starts cleanup
 * 协作入口 / Collaborators: `job`, `setup`, `writeFile`, `manager.init`.
 * 检查边界 / Checked boundaries: `assert.equal(manager.view().policy.enabled, false)`; `assert.ok(manager.view().warning)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('invalid persisted settings fail closed and a failed policy write never starts cleanup', async (t) => {
  const old = job(20),
    data = await setup(t, [old]);
  await writeFile(data.file, '{invalid');
  const manager = new LogRetention(
    () => [data.store],
    data.file,
    undefined,
    () => now,
  );
  await manager.init(false);
  t.after(() => manager.close());
  assert.equal(manager.view().policy.enabled, false);
  assert.ok(manager.view().warning);
  await manager.sweep();
  assert.equal(data.store.get(old.id!)?.log, old.log);
  const badFile = join(data.folder, 'plain-file');
  await writeFile(badFile, 'not a directory');
  const failing = new LogRetention(
    () => [data.store],
    join(badFile, 'policy.json'),
    undefined,
    () => now,
  );
  await failing.init(false);
  t.after(() => failing.close());
  await assert.rejects(failing.save(policy, failing.preview(policy).token));
  assert.equal(failing.view().policy.enabled, false);
  assert.equal(data.store.get(old.id!)?.log, old.log);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the minute scheduler applies the durable policy and shutdown drains an admitted cleanup
 * 状态影响 / State effects: `later.finishedAt`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `t.mock.timers.enable`, `setup`, `manager.init`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal(later.log, 'scheduler expiry')`; `assert.equal(closed, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('the minute scheduler applies the durable policy and shutdown drains an admitted cleanup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
  const data = await setup(t, []);
  const manager = new LogRetention(
    () => [data.store],
    data.file,
    undefined,
    () => now,
  );
  await manager.init();
  t.after(() => manager.close());
  await manager.save(policy, manager.preview(policy).token);
  const later = data.store.start('scheduled-output', async (log) => {
    log('scheduler expiry');
  });
  await data.store.wait('scheduled-output');
  later.finishedAt = new Date(now - 20 * day).toISOString();
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  const clear = data.store.clearCompletedLogs.bind(data.store);
  t.mock.method(data.store, 'clearCompletedLogs', async (...args: Parameters<typeof clear>) => {
    entered(); await finish; return clear(...args);
  });
  t.mock.timers.tick(59999);
  assert.equal(later.log, 'scheduler expiry');
  t.mock.timers.tick(1);
  await admitted;
  let closed = false;
  const closing = manager.close().then(() => { closed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  release(); await closing;
  assert.equal(later.log, '');
  assert.equal(manager.view().lastRun?.removedLogs, 1);
});
