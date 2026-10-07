/**
 * 模块职责：回归验证模块，围绕 `file-locks` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `file-locks`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: file leases exclude overlapping edits, renew and expire without stale-token writes; file lease acquisition waits for an in-flight mutation and then blocks a second writer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FileLocks } from '../server/file-locks.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: file leases exclude overlapping edits, renew and expire without stale-token writes
 * 状态影响 / State effects: `clock`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `locks.acquire`, `assert.equal`, `locks.view`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.equal(locks.view('vm-one', '/workspace/project/main.ts').locked, true)`; `assert.rejects(locks.acquire('vm-one', '/workspace/project'), /已被锁定/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('file leases exclude overlapping edits, renew and expire without stale-token writes', async () => {
  let clock = 1000;
  const locks = new FileLocks(() => clock, 120000);
  const first = await locks.acquire('vm-one', '/workspace/project/main.ts');
  assert.equal(locks.view('vm-one', '/workspace/project/main.ts').locked, true);
  await assert.rejects(locks.acquire('vm-one', '/workspace/project'), /已被锁定/);
  await assert.rejects(locks.acquire('vm-one', '/workspace/project/main.ts'), /已被锁定/);
  await assert.rejects(locks.withMutation('vm-one', ['/workspace/project/main.ts'], undefined,
    async () => 'changed'), /已被其他编辑器锁定/);
  assert.equal(await locks.withMutation('vm-one', ['/workspace/project/main.ts'], first.token,
    async () => 'saved'), 'saved');
  assert.equal(await locks.withMutation('vm-one', ['/workspace/project/other.ts'], undefined,
    async () => 'saved'), 'saved');
  clock += 90000;
  const renewed = await locks.renew('vm-one', first.path, first.token);
  assert.equal(new Date(renewed.expiresAt).getTime(), clock + 120000);
  clock += 120001;
  assert.equal(locks.view('vm-one', first.path).locked, false);
  await assert.rejects(locks.withMutation('vm-one', [first.path], first.token,
    async () => 'changed'), /已过期/);
  const second = await locks.acquire('vm-one', first.path);
  assert.notEqual(second.token, first.token);
  await locks.release('vm-one', first.path, second.token);
  assert.equal(locks.view('vm-one', first.path).locked, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: file lease acquisition waits for an in-flight mutation and then blocks a second writer
 * 协作入口 / Collaborators: `locks.withMutation`, `Promise.resolve`, `locks.acquire`, `acquired.then`.
 * 检查边界 / Checked boundaries: `assert.equal(settled, false)`; `assert.rejects(locks.withMutation('vm-one', ['/workspace/a.txt'], undefined, async () => 'changed'), /已被其他编辑器锁定/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('file lease acquisition waits for an in-flight mutation and then blocks a second writer', async () => {
  const locks = new FileLocks();
  let finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const inFlight = locks.withMutation('vm-one', ['/workspace/a.txt'], undefined,
    () => new Promise<void>((resolve) => { finish = resolve; }));
  await Promise.resolve();
  const acquired = locks.acquire('vm-one', '/workspace/a.txt');
  let settled = false;
  void acquired.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish();
  await inFlight;
  const lease = await acquired;
  await assert.rejects(locks.withMutation('vm-one', ['/workspace/a.txt'], undefined,
    async () => 'changed'), /已被其他编辑器锁定/);
  await locks.release('vm-one', lease.path, lease.token);
});
