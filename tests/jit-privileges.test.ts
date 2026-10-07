/**
 * 模块职责：回归验证模块，围绕 `jit-privileges` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `jit-privileges`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: JIT approval is scoped, durable, expiring, revocable and consumed before execution; JIT denial, revocation, expiry and failed execution cannot be replayed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JitPrivileges } from '../server/jit-privileges.ts';
import type { AccessControl, Principal } from '../server/access-control.ts';
import type { Machines } from '../server/machines.ts';

const vmId = '00000000-0000-4000-8000-000000000001';
const otherVmId = '00000000-0000-4000-8000-000000000002';
const viewerId = '00000000-0000-4000-8000-000000000003';
const ownerId = '00000000-0000-4000-8000-000000000004';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: JIT approval is scoped, durable, expiring, revocable and consumed before execution
 * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.create(owner, { vmId, operation: 'start', reason: 'Need a temporary boot' }), /账户没有/)`; `assert.rejects(service.create(viewer, { vmId: otherVmId, operation: 'start', reason: 'Need a temporary boot' }), /账户没有/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('JIT approval is scoped, durable, expiring, revocable and consumed before execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-jit-'));
  const file = join(directory, 'jit.json');
  let now = Date.UTC(2026, 0, 1), starts = 0, stops = 0, failStart = false;
  const users = [{ id: viewerId, username: 'reader', role: 'viewer' as const,
    vmIds: [vmId], expiresAt: now + 86_400_000 }];
  const access = { enabled: true, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`users`）。
   * Result: Return the branch-computed value (`users`).
   * 验证场景 / Scenario: JIT approval is scoped, durable, expiring, revocable and consumed before execution
   */
  users: () => users } as unknown as AccessControl;
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: JIT approval is scoped, durable, expiring, revocable and consumed before execution
     * 失败 / Failure: `new Error('实例不存在')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    get: (id: string) => {
      if (id !== vmId && id !== otherVmId) throw new Error('实例不存在');
    },
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: JIT approval is scoped, durable, expiring, revocable and consumed before execution
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: JIT approval is scoped, durable, expiring, revocable and consumed before execution
     * 失败 / Failure: `new Error('启动失败')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    start: async () => {
      starts++;
      if (failStart) throw new Error('启动失败');
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; force: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: JIT approval is scoped, durable, expiring, revocable and consumed before execution
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(force, false)`.
     */
    stop: async (_id: string, force: boolean) => {
      assert.equal(force, false);
      stops++;
    },
  } as unknown as Machines;
  const viewer: Principal = { id: viewerId, username: 'reader', role: 'viewer',
    vmIds: [vmId], expiresAt: now + 3_600_000 };
  const owner: Principal = { id: ownerId, username: 'owner', role: 'owner',
    vmIds: [], expiresAt: now + 8 * 3_600_000 };
  const service = new JitPrivileges(access, machines, file, () => now);
  await service.init();
  try {
    await assert.rejects(service.create(owner,
      { vmId, operation: 'start', reason: 'Need a temporary boot' }), /账户没有/);
    await assert.rejects(service.create(viewer,
      { vmId: otherVmId, operation: 'start', reason: 'Need a temporary boot' }), /账户没有/);
    const requested = await service.create(viewer,
      { vmId, operation: 'start', reason: 'Need a temporary boot' });
    assert.equal(requested.status, 'pending');
    assert.equal(service.list(viewer).length, 1);
    assert.equal(service.list({ ...viewer, id: ownerId }).length, 0);
    await assert.rejects(service.execute(viewer, requested.id), /未获有效批准/);
    await assert.rejects(service.decide(viewer, requested.id,
      { decision: 'approve', minutes: 10 }), /只有管理员/);
    const restored = new JitPrivileges(access, machines, file, () => now);
    await restored.init();
    assert.equal(restored.list(owner)[0].id, requested.id);
    const approved = await restored.decide(owner, requested.id,
      { decision: 'approve', minutes: 10 });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.expiresAt, now + 600_000);
    const [first, replay] = await Promise.allSettled([
      restored.execute(viewer, requested.id), restored.execute(viewer, requested.id),
    ]);
    assert.equal(first.status, 'fulfilled');
    assert.equal(replay.status, 'rejected');
    assert.equal(starts, 1);
    assert.equal(restored.list(owner)[0].status, 'completed');
    const expired = await restored.create(viewer,
      { vmId, operation: 'stop', reason: 'Need a clean shutdown' });
    now += 86_400_001;
    assert.equal(restored.list(owner).find((item) => item.id === expired.id)?.status, 'expired');
    await assert.rejects(restored.decide(owner, expired.id,
      { decision: 'approve', minutes: 1 }), /不再等待审批/);
    await restored.close();
    await service.close();
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: JIT denial, revocation, expiry and failed execution cannot be replayed
 * 状态影响 / State effects: `now`, `viewerExpiry`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.equal((await service.decide(owner, denied.id, { decision: 'deny' })).status, 'denied')`; `assert.rejects(service.execute(viewer, denied.id), /未获有效批准/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('JIT denial, revocation, expiry and failed execution cannot be replayed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-jit-'));
  let now = Date.UTC(2026, 0, 1), attempts = 0, viewerExpiry = now + 86_400_000;
  const access = { enabled: true, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 验证场景 / Scenario: JIT denial, revocation, expiry and failed execution cannot be replayed
   */
  users: () => [{ id: viewerId, role: 'viewer',
    vmIds: [vmId], expiresAt: viewerExpiry }] } as unknown as AccessControl;
  const machines = { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({})`）。
   * Result: Return the branch-computed value (`({})`).
   * 验证场景 / Scenario: JIT denial, revocation, expiry and failed execution cannot be replayed
   */
  get: () => ({}), /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: JIT denial, revocation, expiry and failed execution cannot be replayed
   */
  requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: JIT denial, revocation, expiry and failed execution cannot be replayed
     * 失败 / Failure: `new Error('QEMU failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    start: async () => { attempts++; throw new Error('QEMU failed'); },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: JIT denial, revocation, expiry and failed execution cannot be replayed
     */
    stop: async () => {} } as unknown as Machines;
  const viewer: Principal = { id: viewerId, username: 'reader', role: 'viewer',
    vmIds: [vmId], expiresAt: now + 3_600_000 };
  const owner: Principal = { id: ownerId, username: 'owner', role: 'owner',
    vmIds: [], expiresAt: now + 8 * 3_600_000 };
  const service = new JitPrivileges(access, machines, join(directory, 'jit.json'), () => now);
  await service.init();
  try {
    const denied = await service.create(viewer,
      { vmId, operation: 'start', reason: 'Need a temporary boot' });
    assert.equal((await service.decide(owner, denied.id, { decision: 'deny' })).status, 'denied');
    await assert.rejects(service.execute(viewer, denied.id), /未获有效批准/);
    const revoked = await service.create(viewer,
      { vmId, operation: 'start', reason: 'Need a temporary boot' });
    await service.decide(owner, revoked.id, { decision: 'approve', minutes: 1 });
    assert.equal((await service.decide(owner, revoked.id, { decision: 'deny' })).status, 'revoked');
    await assert.rejects(service.execute(viewer, revoked.id), /未获有效批准/);
    const expired = await service.create(viewer,
      { vmId, operation: 'start', reason: 'Need a temporary boot' });
    await service.decide(owner, expired.id, { decision: 'approve', minutes: 1 });
    now += 60_001;
    await assert.rejects(service.execute(viewer, expired.id), /未获有效批准/);
    const failed = await service.create(viewer,
      { vmId, operation: 'start', reason: 'Need a temporary boot' });
    await service.decide(owner, failed.id, { decision: 'approve', minutes: 1 });
    await assert.rejects(service.execute(viewer, failed.id), /实例启动失败/);
    assert.equal(service.list(owner).find((item) => item.id === failed.id)?.status, 'failed');
    await assert.rejects(service.execute(viewer, failed.id), /已使用/);
    assert.equal(attempts, 1);
    viewerExpiry = now - 1;
    await assert.rejects(service.create(viewer,
      { vmId, operation: 'stop', reason: 'Need a clean shutdown' }), /账户已失效/);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
