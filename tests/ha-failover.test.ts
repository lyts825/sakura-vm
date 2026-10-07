/**
 * 模块职责：回归验证模块，围绕 `ha-failover` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-failover`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: failover policy accepts bounded health settings and rejects unknown parameters; failover health check identifies a fresh verified replica without claiming safe takeover.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { checkHaFailover, haFailoverOptions } from '../server/ha-failover.ts';
import type { Machines } from '../server/machines.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { SnapshotReplications } from '../server/snapshot-replications.ts';

const vmId = randomUUID(), snapshotId = randomUUID(), remoteVmId = randomUUID();
const peerId = randomUUID(), targetHostId = randomUUID(), transferId = randomUUID();
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: snapshotAt: string; source: 'running' | 'error' = 'running'。
 * 结果：返回分支计算值（`({ get: () => ({ cpus: 2, memoryMiB: 1024, snapshots: [{ id: snapshotId, created…`）。
 * Result: Return the branch-computed value (`({ get: () => ({ cpus: 2, memoryMiB: 1024, snapshots: [{ id: snapshotId, created…`).
 */
const machines = (snapshotAt: string, source: 'running' | 'error' = 'running') => ({
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ cpus: 2, memoryMiB: 1024, snapshots: [{ id: snapshotId, createdAt: snapshotAt…`）。
   * Result: Return the branch-computed value (`({ cpus: 2, memoryMiB: 1024, snapshots: [{ id: snapshotId, createdAt: snapshotAt…`).
   */
  get: () => ({ cpus: 2, memoryMiB: 1024,
    snapshots: [{ id: snapshotId, createdAt: snapshotAt }] }),
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`source`）。
   * Result: Return the branch-computed value (`source`).
   */
  state: () => source,
  live: new Map(),
}) as unknown as Machines;
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: eligible = true。
 * 结果：返回分支计算值（`({ score: async () => ({ candidates: [ { id: randomUUID(), source: 'local', name…`）。
 * Result: Return the branch-computed value (`({ score: async () => ({ candidates: [ { id: randomUUID(), source: 'local', name…`).
 */
const peers = (eligible = true) => ({
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ candidates: [ { id: randomUUID(), source: 'local', name: 'source', eligible: …`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ candidates: [ { id: randomUUID(), source: 'local', name: 'source', eligible: …`) through a Promise.
   * 协作入口 / Collaborators: `randomUUID`, `Date.now`.
   */
  score: async () => ({ candidates: [
    { id: randomUUID(), source: 'local', name: 'source', eligible: true,
      status: { platform: 'win32', arch: 'x64' } },
    { id: targetHostId, source: 'peer', name: 'standby', eligible,
      status: { platform: 'win32', arch: 'x64' },
      reasons: eligible ? [] : ['空闲内存不足'], observedAt: Date.now() },
  ] }),
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ outbound: [{ id: peerId, remoteId: targetHostId }] })`）。
   * Result: Return the branch-computed value (`({ outbound: [{ id: peerId, remoteId: targetHostId }] })`).
   */
  view: () => ({ outbound: [{ id: peerId, remoteId: targetHostId }] }),
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id: remoteVmId, sha256: 'a'.repeat(64), sourceVmId: vmId, snapshotId })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ id: remoteVmId, sha256: 'a'.repeat(64), sourceVmId: vmId, snapshotId })`) through a Promise.
   * 协作入口 / Collaborators: `'a'.repeat`.
   */
  importStatus: async () => ({ id: remoteVmId, sha256: 'a'.repeat(64),
    sourceVmId: vmId, snapshotId }),
  /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ready: true, id: remoteVmId, status: 'stopped' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ready: true, id: remoteVmId, status: 'stopped' })`) through a Promise.
   */
  checkReplicaActivation: async () => ({ ready: true, id: remoteVmId,
    status: 'stopped' }),
}) as unknown as HostPeers;
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`({ view: () => ({ entries: [{ vmId, peerId, snapshotId, transferId, remoteVmId, …`）。
 * Result: Return the branch-computed value (`({ view: () => ({ entries: [{ vmId, peerId, snapshotId, transferId, remoteVmId, …`).
 */
const replications = () => ({ /**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`({ entries: [{ vmId, peerId, snapshotId, transferId, remoteVmId, sha256: 'a'.rep…`）。
 * Result: Return the branch-computed value (`({ entries: [{ vmId, peerId, snapshotId, transferId, remoteVmId, sha256: 'a'.rep…`).
 * 协作入口 / Collaborators: `'a'.repeat`, `new Date().toISOString`.
 */
view: () => ({ entries: [{
  vmId, peerId, snapshotId, transferId, remoteVmId, sha256: 'a'.repeat(64),
  status: 'replicated', createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}] }) }) as unknown as SnapshotReplications;

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failover policy accepts bounded health settings and rejects unknown parameters
 * 协作入口 / Collaborators: `assert.deepEqual`, `haFailoverOptions.parse`, `assert.equal`, `haFailoverOptions.safeParse`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(haFailoverOptions.parse({ targetHostId }), { targetHostId, failureThreshold: 3, maxReplicaAgeMinutes: 1440, autoP…`; `assert.equal(haFailoverOptions.safeParse({ targetHostId, failureThreshold: 1 }).success, false)`.
 */
test('failover policy accepts bounded health settings and rejects unknown parameters', () => {
  assert.deepEqual(haFailoverOptions.parse({ targetHostId }), {
    targetHostId, failureThreshold: 3, maxReplicaAgeMinutes: 1440,
    autoProcessFailover: false, autoHostFailover: false,
  });
  assert.equal(haFailoverOptions.safeParse({ targetHostId, failureThreshold: 1 }).success, false);
  assert.equal(haFailoverOptions.safeParse({ targetHostId, command: 'start' }).success, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failover health check identifies a fresh verified replica without claiming safe takeover
 * 协作入口 / Collaborators: `checkHaFailover`, `machines`, `new Date().toISOString`, `peers`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ready, false)`; `assert.equal(result.executed, false)`.
 */
test('failover health check identifies a fresh verified replica without claiming safe takeover', async () => {
  const result = await checkHaFailover(machines(new Date().toISOString()), peers(),
    replications(), vmId, { targetHostId }, true);
  assert.equal(result.ready, false);
  assert.equal(result.executed, false);
  assert.equal(result.target?.hostId, targetHostId);
  assert.equal(result.replica?.remoteVmId, remoteVmId);
  assert.equal(result.replica?.receiptVerified, true);
  assert.ok(result.blockers.some((item) => item.includes('未启用独立见证')));
  assert.equal(result.hostPlanReady, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: host-loss plan requires an eligible verified stopped replica
 * 协作入口 / Collaborators: `checkHaFailover`, `machines`, `new Date().toISOString`, `peers`.
 * 检查边界 / Checked boundaries: `assert.equal(ready.hostPlanReady, true)`; `assert.equal(ready.replica?.standbyStatus, 'stopped')`.
 */
test('host-loss plan requires an eligible verified stopped replica', async () => {
  const ready = await checkHaFailover(machines(new Date().toISOString()), peers(),
    replications(), vmId, { targetHostId, autoHostFailover: true }, true);
  assert.equal(ready.hostPlanReady, true);
  assert.equal(ready.replica?.standbyStatus, 'stopped');
  const unavailable = await checkHaFailover(machines(new Date().toISOString()), peers(false),
    replications(), vmId, { targetHostId, autoHostFailover: true }, true);
  assert.equal(unavailable.hostPlanReady, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: fresh verified replica can pass the local process-only preflight after QEMU exits
 * 协作入口 / Collaborators: `checkHaFailover`, `machines`, `new Date().toISOString`, `peers`.
 * 检查边界 / Checked boundaries: `assert.equal(unevidenced.localProcessReady, false)`; `assert.equal(result.ready, false)`.
 */
test('fresh verified replica can pass the local process-only preflight after QEMU exits', async () => {
  const unevidenced = await checkHaFailover(machines(new Date().toISOString(), 'error'),
    peers(), replications(), vmId, { targetHostId, autoProcessFailover: true }, true);
  assert.equal(unevidenced.localProcessReady, false);
  const result = await checkHaFailover(machines(new Date().toISOString(), 'error'),
    peers(), replications(), vmId, { targetHostId, autoProcessFailover: true }, true,
    undefined, true, true);
  assert.equal(result.ready, false);
  assert.equal(result.localProcessReady, true);
  assert.equal(result.replica?.transferId, transferId);
  assert.equal(result.replica?.peerId, peerId);
  assert.equal(result.replica?.standbyStatus, 'stopped');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: local process preflight rejects a standby without activation permission
 * 协作入口 / Collaborators: `peers`, `checkHaFailover`, `machines`, `new Date().toISOString`.
 * 检查边界 / Checked boundaries: `assert.equal(result.localProcessReady, false)`; `assert.ok(result.blockers.some((item) => item.includes('HTTP 403')))`.
 */
test('local process preflight rejects a standby without activation permission', async () => {
  const forbidden = { ...peers(), /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: local process preflight rejects a standby without activation permission
   * 失败 / Failure: `new Error('HTTP 403')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  checkReplicaActivation: async () => {
    throw new Error('HTTP 403');
  } } as unknown as HostPeers;
  const result = await checkHaFailover(machines(new Date().toISOString(), 'error'),
    forbidden, replications(), vmId, { targetHostId, autoProcessFailover: true },
    true, undefined, true, true);
  assert.equal(result.localProcessReady, false);
  assert.ok(result.blockers.some((item) => item.includes('HTTP 403')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failover health check rejects a vanished standby receipt
 * 协作入口 / Collaborators: `peers`, `checkHaFailover`, `machines`, `new Date().toISOString`.
 * 检查边界 / Checked boundaries: `assert.equal(result.replica?.receiptVerified, false)`; `assert.ok(result.blockers.some((item) => item.includes('回执缺失')))`.
 */
test('failover health check rejects a vanished standby receipt', async () => {
  const unavailable = { ...peers(), /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`null`），以 Promise 交付。
   * Result: Return the branch-computed value (`null`) through a Promise.
   * 验证场景 / Scenario: failover health check rejects a vanished standby receipt
   */
  importStatus: async () => null } as unknown as HostPeers;
  const result = await checkHaFailover(machines(new Date().toISOString()), unavailable,
    replications(), vmId, { targetHostId }, true);
  assert.equal(result.replica?.receiptVerified, false);
  assert.ok(result.blockers.some((item) => item.includes('回执缺失')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failover health check flags disabled, stale and undersized standby state
 * 协作入口 / Collaborators: `new Date(Date.now() - 3 * 86400_000).toISOString`, `Date.now`, `checkHaFailover`, `machines`.
 * 检查边界 / Checked boundaries: `assert.ok(result.blockers.some((item) => item.includes('已禁用')))`; `assert.ok(result.blockers.some((item) => item.includes('内存不足')))`.
 */
test('failover health check flags disabled, stale and undersized standby state', async () => {
  const old = new Date(Date.now() - 3 * 86400_000).toISOString();
  const result = await checkHaFailover(machines(old), peers(false), replications(),
    vmId, { targetHostId, maxReplicaAgeMinutes: 60 }, false);
  assert.ok(result.blockers.some((item) => item.includes('已禁用')));
  assert.ok(result.blockers.some((item) => item.includes('内存不足')));
  assert.ok(result.blockers.some((item) => item.includes('时效上限')));
});
