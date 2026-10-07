/**
 * 模块职责：回归验证模块，围绕 `session-lock` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `session-lock`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: idle expiry is checked on access; read polling never extends it, activity does, and restart locks; five failed passwords start a durable cooldown; password changes and disabling require the current proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { SessionLock } from '../server/session-lock.ts';

const password = 'test-only long passphrase!';
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: expected: number。
 * 结果：返回分支计算值（`(error: any) => error.status === expected`）。
 * Result: Return the branch-computed value (`(error: any) => error.status === expected`).
 */
const status = (expected: number) => (error: any) => error.status === expected;
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: test.TestContext。
 * 结果：返回受控对象，公开字段包括 `file, create, transitions, advance`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `file, create, transitions, advance`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep))`.
 */
async function setup(t: test.TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'sakura-session-lock-'));
  assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep));
  const file = join(folder, 'session.json');
  let now = Date.now();
  const transitions: boolean[] = [],
    managers: SessionLock[] = [];
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`manager`），以 Promise 交付。
   * Result: Return the branch-computed value (`manager`) through a Promise.
   * 协作入口 / Collaborators: `managers.push`, `manager.init`.
   */
  const create = async () => {
    const manager = new SessionLock(
      (locked, transitioned) => {
        if (transitioned) transitions.push(locked);
      },
      file,
      () => now,
    );
    managers.push(manager);
    await manager.init(false);
    return manager;
  };
  t.after(async () => {
    for (const manager of managers) await manager.close();
    await rm(folder, { recursive: true, force: true });
  });
  return {
    file,
    create,
    transitions,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: delta: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    advance: (delta: number) => {
      now += delta;
    },
  };
}
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: manager: SessionLock。
 * 结果：返回分支计算值（`manager.configure({ enabled: true, idleMinutes: 1, newPassword: password })`）。
 * Result: Return the branch-computed value (`manager.configure({ enabled: true, idleMinutes: 1, newPassword: password })`).
 * 协作入口 / Collaborators: `manager.configure`.
 */
const enable = (manager: SessionLock) =>
  manager.configure({ enabled: true, idleMinutes: 1, newPassword: password });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: idle expiry is checked on access; read polling never extends it, activity does, and restart locks
 * 协作入口 / Collaborators: `setup`, `fixture.create`, `assert.equal`, `manager.view`.
 * 检查边界 / Checked boundaries: `assert.equal(manager.view().enabled, false)`; `assert.equal(manager.view().expiresAt, initial)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('idle expiry is checked on access; read polling never extends it, activity does, and restart locks', async (t) => {
  const fixture = await setup(t),
    manager = await fixture.create();
  assert.equal(manager.view().enabled, false);
  await enable(manager);
  const initial = manager.view().expiresAt!;
  fixture.advance(45000);
  manager.view();
  manager.requireUnlocked();
  assert.equal(manager.view().expiresAt, initial);
  assert.equal(manager.activity().expiresAt, initial + 45000);
  fixture.advance(60000);
  assert.throws(() => manager.requireUnlocked(), status(423));
  assert.equal(manager.view().reason, 'idle');
  assert.throws(() => manager.activity(), status(423));
  await manager.unlock({ password });
  assert.equal(manager.view().locked, false);
  assert.deepEqual(fixture.transitions, [true, false]);
  await manager.close();
  const restored = await fixture.create();
  assert.equal(restored.view().locked, true);
  assert.equal(restored.view().reason, 'startup');
  assert.ok(!JSON.stringify(restored.view()).includes('hash'));
  assert.ok(!(await readFile(fixture.file, 'utf8')).includes(password));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: five failed passwords start a durable cooldown; password changes and disabling require the current proof
 * 协作入口 / Collaborators: `setup`, `fixture.create`, `enable`, `manager.lock`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.unlock({ password: 'wrong' }), status(403))`; `assert.equal(manager.view().retryAfterSeconds, 60)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('five failed passwords start a durable cooldown; password changes and disabling require the current proof', async (t) => {
  const fixture = await setup(t),
    manager = await fixture.create();
  await enable(manager);
  manager.lock();
  for (let i = 0; i < 5; i++) await assert.rejects(manager.unlock({ password: 'wrong' }), status(403));
  assert.equal(manager.view().retryAfterSeconds, 60);
  await assert.rejects(manager.unlock({ password }), status(429));
  await manager.close();
  const restored = await fixture.create();
  await assert.rejects(restored.unlock({ password }), status(429));
  fixture.advance(60001);
  await restored.unlock({ password });
  assert.equal(restored.view().retryAfterSeconds, 0);
  await assert.rejects(restored.configure({ enabled: false, idleMinutes: 1 }), status(403));
  const replacement = 'replacement passphrase';
  await restored.configure({ enabled: true, idleMinutes: 1, password, newPassword: replacement });
  restored.lock();
  await assert.rejects(restored.unlock({ password }), status(403));
  await restored.unlock({ password: replacement });
  await restored.configure({ enabled: false, idleMinutes: 1, password: replacement });
  assert.equal(restored.view().enabled, false);
  await restored.close();
  const disabled = await fixture.create();
  assert.equal(disabled.view().locked, false);
  assert.equal(disabled.view().configured, true);
  await assert.rejects(
    disabled.configure({ enabled: true, idleMinutes: 1, newPassword: password }),
    status(403),
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pending verification cannot unlock a newer lock; parallel password work is bounded and shutdown drains it
 * 协作入口 / Collaborators: `setup`, `fixture.create`, `enable`, `manager.lock`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.unlock({ password }), status(429))`; `assert.rejects(unlocking, status(409))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('pending verification cannot unlock a newer lock; parallel password work is bounded and shutdown drains it', async (t) => {
  const fixture = await setup(t),
    manager = await fixture.create();
  await enable(manager);
  manager.lock();
  const unlocking = manager.unlock({ password });
  await assert.rejects(manager.unlock({ password }), status(429));
  manager.lock();
  await assert.rejects(unlocking, status(409));
  assert.equal(manager.view().locked, true);
  await manager.unlock({ password });
  const changing = manager.configure({ enabled: false, idleMinutes: 1, password });
  manager.lock();
  await assert.rejects(changing, status(423));
  const closingProof = manager.unlock({ password });
  const rejected = assert.rejects(closingProof, status(409));
  await manager.close();
  await rejected;
  assert.throws(() => manager.requireUnlocked(), status(503));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: verified owner passkey unlocks only the exact locked generation and resets the cooldown
 * 协作入口 / Collaborators: `setup`, `fixture.create`, `enable`, `manager.lock`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.unlockWithPasskey(stale), status(409))`; `assert.rejects(manager.unlock({ password: 'wrong' }), status(403))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('verified owner passkey unlocks only the exact locked generation and resets the cooldown', async (t) => {
  const fixture = await setup(t), manager = await fixture.create();
  await enable(manager);
  manager.lock();
  const stale = manager.getGeneration();
  manager.lock();
  await assert.rejects(manager.unlockWithPasskey(stale), status(409));
  for (let i = 0; i < 5; i++) await assert.rejects(manager.unlock({ password: 'wrong' }), status(403));
  const current = manager.getGeneration();
  assert.equal((await manager.unlockWithPasskey(current)).locked, false);
  assert.equal(manager.view().retryAfterSeconds, 0);
  await assert.rejects(manager.unlockWithPasskey(current), status(409));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: missing credentials, malformed storage, clock rollback and expiry during configuration fail closed
 * 协作入口 / Collaborators: `setup`, `fixture.create`, `assert.rejects`, `manager.configure`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.configure({ enabled: true, idleMinutes: 1 }), /12/)`; `assert.throws(() => manager.configure({ enabled: true, idleMinutes: 0, newPassword: password }))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('missing credentials, malformed storage, clock rollback and expiry during configuration fail closed', async (t) => {
  const fixture = await setup(t),
    manager = await fixture.create();
  await assert.rejects(manager.configure({ enabled: true, idleMinutes: 1 }), /12/);
  assert.throws(() => manager.configure({ enabled: true, idleMinutes: 0, newPassword: password }));
  await enable(manager);
  fixture.advance(-1);
  assert.throws(() => manager.requireUnlocked(), status(423));
  await manager.unlock({ password });
  const configuring = manager.configure({ enabled: false, idleMinutes: 1, password });
  fixture.advance(60000);
  await assert.rejects(configuring, status(423));
  assert.equal(manager.view().enabled, true);
  await manager.close();
  await writeFile(fixture.file, '{invalid');
  await assert.rejects(fixture.create(), status(503));
});
