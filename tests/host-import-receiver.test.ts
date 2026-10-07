/**
 * 模块职责：回归验证模块，围绕 `host-import-receiver` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `host-import-receiver`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: HA activation works while the web session is locked and passes the complete replica identity; wrong origins, checksums, retired replicas and non-runnable states never launch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHostImportReceiver } from '../server/host-import-receiver.ts';
import { createSchema, type VMRecord, type VMStatus } from '../server/model.ts';
import type { Machines } from '../server/machines.ts';
import type { Bundles } from '../server/bundles.ts';

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `input, receiver, vm, starts, retirements, setStatus, lockSession, lockIncident, block`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `input, receiver, vm, starts, retirements, setStatus, lockSession, lockIncident, block`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `'a'.repeat`, `createSchema.parse`, `new Date().toISOString`.
 */
function fixture() {
  const input = { requesterId: randomUUID(), transferId: randomUUID(), remoteVmId: randomUUID(),
    sourceVmId: randomUUID(), snapshotId: randomUUID(), sha256: 'a'.repeat(64) };
  const vm: VMRecord = { ...createSchema.parse({ name: 'standby' }), id: input.remoteVmId,
    createdAt: new Date().toISOString(), snapshots: [], migrationOrigin: {
      sourceHostId: input.requesterId, transferId: input.transferId, targetName: 'standby',
      diskSha256: input.sha256, sourceVmId: input.sourceVmId, snapshotId: input.snapshotId } };
  let status: VMStatus = 'stopped', sessionLocked = false, incidentLocked = false,
    blocked = false, enabled = true;
  const starts: unknown[] = [], retirements: unknown[] = [];
  const machines = { records: new Map([[vm.id, vm]]), /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`vm`）。
   * Result: Return the branch-computed value (`vm`).
   */
  get: () => vm, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`status`）。
   * Result: Return the branch-computed value (`status`).
   */
  state: () => status,
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('incident locked')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    requireUnlocked: () => { if (incidentLocked) throw new Error('incident locked'); },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `starts.push`.
     */
    start: async () => { starts.push('ordinary'); status = 'starting'; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: id: string; identity: unknown。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `starts.push`.
     */
    startHaReplica: async (id: string, identity: unknown) => {
      starts.push({ id, identity }); status = 'starting';
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string; identity: unknown。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `retirements.push`.
     */
    retireHaReplica: async (id: string, identity: unknown) => { retirements.push({ id, identity }); },
  } as unknown as Machines;
  const receiver = createHostImportReceiver(machines, {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`enabled ? {} as Bundles : undefined`）。
     * Result: Return the branch-computed value (`enabled ? {} as Bundles : undefined`).
     */
    bundles: () => enabled ? {} as Bundles : undefined,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`blocked`）。
     * Result: Return the branch-computed value (`blocked`).
     */
    migrationBlocked: () => blocked,
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('session locked')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    requireSessionUnlocked: () => { if (sessionLocked) throw new Error('session locked'); },
  });
  return { input, receiver, vm, starts, retirements, /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: value: VMStatus。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  setStatus: (value: VMStatus) => { status = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `sessionLocked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    lockSession: () => { sessionLocked = true; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `incidentLocked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    lockIncident: () => { incidentLocked = true; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `blocked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    block: () => { blocked = true; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `enabled`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    disable: () => { enabled = false; } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HA activation works while the web session is locked and passes the complete replica identity
 * 协作入口 / Collaborators: `fixture`, `f.lockSession`, `assert.equal`, `f.receiver.inspectReplicaActivation!`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.receiver.inspectReplicaActivation!(f.input)).status, 'stopped')`; `assert.equal((await f.receiver.activateReplica!(f.input)).status, 'starting')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('HA activation works while the web session is locked and passes the complete replica identity', async () => {
  const f = fixture(); f.lockSession();
  assert.equal((await f.receiver.inspectReplicaActivation!(f.input)).status, 'stopped');
  assert.equal((await f.receiver.activateReplica!(f.input)).status, 'starting');
  assert.deepEqual(f.starts, [{ id: f.input.remoteVmId, identity: {
    sourceHostId: f.input.requesterId, transferId: f.input.transferId,
    sourceVmId: f.input.sourceVmId, snapshotId: f.input.snapshotId, sha256: f.input.sha256 } }]);
  await f.receiver.activateReplica!(f.input);
  assert.equal(f.starts.length, 1, 'a repeated request cannot launch a second guest');
  await assert.rejects(f.receiver.activate!(f.input), /session locked/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: wrong origins, checksums, retired replicas and non-runnable states never launch
 * 状态影响 / State effects: `retired.vm.haRetirement`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.receiver.activateReplica!`, `'b'.repeat`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.receiver.activateReplica!({ ...f.input, [key]: key === 'sha256' ? 'b'.repeat(64) : randomUUID() }), /身份或快照校验值/)`; `assert.equal(f.starts.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('wrong origins, checksums, retired replicas and non-runnable states never launch', async () => {
  for (const key of ['requesterId', 'transferId', 'sourceVmId', 'snapshotId', 'sha256'] as const) {
    const f = fixture();
    await assert.rejects(f.receiver.activateReplica!({ ...f.input,
      [key]: key === 'sha256' ? 'b'.repeat(64) : randomUUID() }), /身份或快照校验值/);
    assert.equal(f.starts.length, 0);
  }
  for (const status of ['paused', 'stopping', 'error'] as const) {
    const f = fixture(); f.setStatus(status);
    await assert.rejects(f.receiver.activateReplica!(f.input), /需要人工复核/);
    assert.equal(f.starts.length, 0);
  }
  const retired = fixture();
  retired.vm.haRetirement = { sourceHostId: retired.input.requesterId,
    transferId: retired.input.transferId, sourceVmId: retired.input.sourceVmId,
    snapshotId: retired.input.snapshotId, sha256: retired.input.sha256,
    retiredAt: new Date().toISOString() };
  await assert.rejects(retired.receiver.activateReplica!(retired.input), /退出接管/);
  assert.equal(retired.starts.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: maintenance, incident locks and missing plugins reject HA starts and retirement
 * 协作入口 / Collaborators: `fixture`, `f[guard]`, `assert.rejects`, `f.receiver.activateReplica!`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.receiver.activateReplica!(f.input))`; `assert.rejects(f.receiver.retireReplica!(f.input))`.
 */
test('maintenance, incident locks and missing plugins reject HA starts and retirement', async () => {
  for (const guard of ['block', 'lockIncident', 'disable'] as const) {
    const f = fixture(); f[guard]();
    await assert.rejects(f.receiver.activateReplica!(f.input));
    await assert.rejects(f.receiver.retireReplica!(f.input));
    assert.equal(f.starts.length, 0); assert.equal(f.retirements.length, 0);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: snapshot receipts cannot use ordinary migration activation and retirement preserves identity
 * 协作入口 / Collaborators: `fixture`, `f.receiver.status`, `assert.deepEqual`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(receipt, { id: f.vm.id, name: 'standby', sha256: f.input.sha256, sourceVmId: f.input.sourceVmId, snapshotId: f.in…`; `assert.equal(await f.receiver.status({ ...f.input, requesterId: randomUUID() }), null)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('snapshot receipts cannot use ordinary migration activation and retirement preserves identity', async () => {
  const f = fixture();
  const receipt = await f.receiver.status(f.input);
  assert.deepEqual(receipt, { id: f.vm.id, name: 'standby', sha256: f.input.sha256,
    sourceVmId: f.input.sourceVmId, snapshotId: f.input.snapshotId });
  assert.equal(await f.receiver.status({ ...f.input, requesterId: randomUUID() }), null);
  await assert.rejects(f.receiver.activate!(f.input), /快照复制副本不能/);
  f.lockSession();
  assert.deepEqual(await f.receiver.retireReplica!(f.input), { id: f.vm.id, retired: true });
  assert.deepEqual(f.retirements, [{ id: f.input.remoteVmId, identity: {
    sourceHostId: f.input.requesterId, transferId: f.input.transferId,
    sourceVmId: f.input.sourceVmId, snapshotId: f.input.snapshotId, sha256: f.input.sha256 } }]);
});
