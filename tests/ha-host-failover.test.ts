/**
 * 模块职责：回归验证模块，围绕 `ha-host-failover` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-host-failover`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal; pending return heartbeats resume after source restart even with the HA policy revoked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HaHostFailover } from '../server/ha-host-failover.ts';
import type { HaWitnessClient } from '../server/ha-witness-client.ts';
import type { Machines } from '../server/machines.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { SnapshotReplications } from '../server/snapshot-replications.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
 * 状态影响 / State effects: `scoreGate`, `state`, `arch`, `policyEnabled`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `'a'.repeat`, `new Date().toISOString`, `failover.sample`.
 * 检查边界 / Checked boundaries: `assert.equal(heartbeats.at(-1)?.plan?.remoteVmId, remoteVmId)`; `assert.equal(failover.view(id).armed, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('source heartbeat arms only a verified compatible standby and start checks witness even after policy removal', async () => {
  const sourceHostId = randomUUID(), id = randomUUID(), targetHostId = randomUUID();
  const remoteVmId = randomUUID(), snapshotId = randomUUID(), transferId = randomUUID();
  const peerId = randomUUID(), sha256 = 'a'.repeat(64), at = new Date().toISOString();
  let state: 'running' | 'stopped' = 'running', arch = 'x64', policyEnabled = true;
  const heartbeats: Array<{ plan?: { remoteVmId: string } | null }> = [];
  let witnessArmed = false, scoreGate: Promise<void> | null = null;
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
   */
  let scoreEntered = () => {};
  let starts = 0;
  const vm = { id, cpus: 2, memoryMiB: 1024,
    snapshots: [{ id: snapshotId, createdAt: at }],
    haWitnessEnrollment: { targetHostId, failureThreshold: 3, registeredAt: at } };
  const machines = {
    records: new Map([[id, vm]]), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     */
    get: () => vm, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`state`）。
     * Result: Return the branch-computed value (`state`).
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     */
    state: () => state, live: new Map(),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     */
    requireUnlocked: () => {}, /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     */
    requireStopped: () => {},
  } as unknown as Machines;
  const peers = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ hostId: sourceHostId, outbound: [{ id: peerId, remoteId: targetHostId }] })`）。
     * Result: Return the branch-computed value (`({ hostId: sourceHostId, outbound: [{ id: peerId, remoteId: targetHostId }] })`).
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     */
    view: () => ({ hostId: sourceHostId,
      outbound: [{ id: peerId, remoteId: targetHostId }] }),
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `candidates`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `candidates`; the actual branch determines its shape.
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     * 协作入口 / Collaborators: `scoreEntered`, `Date.now`.
     */
    score: async () => {
      if (scoreGate) { scoreEntered(); await scoreGate; }
      return { candidates: [
      { source: 'local', id: sourceHostId, status: { platform: 'win32', arch: 'x64' } },
      { source: 'peer', id: targetHostId, name: 'target', eligible: true,
        reasons: [], observedAt: Date.now(), status: { platform: 'win32', arch } },
      ] };
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: remoteVmId, sha256, sourceVmId: id, snapshotId })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ id: remoteVmId, sha256, sourceVmId: id, snapshotId })`) through a Promise.
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     */
    importStatus: async () => ({ id: remoteVmId, sha256, sourceVmId: id, snapshotId }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ready: true, id: remoteVmId, status: 'stopped' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ready: true, id: remoteVmId, status: 'stopped' })`) through a Promise.
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     */
    checkReplicaActivation: async () => ({ ready: true, id: remoteVmId, status: 'stopped' }),
  } as unknown as HostPeers;
  const replications = { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ entries: [{ vmId: id, peerId, snapshotId, transferId, remoteVmId, sha256, sta…`）。
   * Result: Return the branch-computed value (`({ entries: [{ vmId: id, peerId, snapshotId, transferId, remoteVmId, sha256, sta…`).
   * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
   */
  view: () => ({ entries: [{ vmId: id, peerId, snapshotId,
    transferId, remoteVmId, sha256, status: 'replicated', createdAt: at,
    updatedAt: at }] }) } as unknown as SnapshotReplications;
  const client = {
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: input: { plan?: { remoteVmId: string } | null }。
     * 结果：返回受控对象，公开字段包括 `armed`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `armed`; the actual branch determines its shape.
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     * 状态影响 / State effects: `witnessArmed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `heartbeats.push`.
     */
    heartbeat: async (input: { plan?: { remoteVmId: string } | null }) => {
      heartbeats.push(input);
      if ('plan' in input) witnessArmed = !!input.plan;
      return { armed: witnessArmed };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     */
    authorizeStart: async () => { starts++; },
  } as unknown as HaWitnessClient;
  const policy = { enabled: true, options: { targetHostId,
    failureThreshold: 3, maxReplicaAgeMinutes: 60, autoHostFailover: true } };
  const failover = new HaHostFailover(machines, peers, replications,
    async () => policyEnabled ? { [id]: policy } : {}, client);
  try {
    await failover.sample();
    assert.equal(heartbeats.at(-1)?.plan?.remoteVmId, remoteVmId);
    assert.equal(failover.view(id).armed, true);
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: source heartbeat arms only a verified compatible standby and start checks witness even after policy removal
     */
    let releaseScore = () => {};
    scoreGate = new Promise<void>((resolve) => { releaseScore = resolve; });
    const entered = new Promise<void>((resolve) => { scoreEntered = resolve; });
    const slowScan = failover.sample();
    await entered;
    assert.equal(Object.hasOwn(heartbeats.at(-1)!, 'plan'), false,
      'source liveness is refreshed without disarming during slow peer validation');
    assert.equal(witnessArmed, true);
    releaseScore();
    await slowScan;
    scoreGate = null;
    const disarmStart = heartbeats.length;
    scoreGate = new Promise<void>((resolve) => { releaseScore = resolve; });
    const rechecking = new Promise<void>((resolve) => { scoreEntered = resolve; });
    const validating = failover.sample();
    await rechecking;
    state = 'stopped';
    let disarmFinished = false;
    const withdrawing = failover.disarm(id, 3).then(() => { disarmFinished = true; });
    await Promise.resolve();
    assert.equal(disarmFinished, false, 'withdrawal waits for the earlier peer scan');
    releaseScore();
    await Promise.all([validating, withdrawing]);
    scoreGate = null;
    assert.equal(witnessArmed, false);
    assert.equal(failover.view(id).armed, false);
    assert.equal(heartbeats.slice(disarmStart).some((item) => !!item.plan), false,
      'a source that exited during validation cannot publish the old plan');
    state = 'running';
    await failover.sample();
    assert.equal(witnessArmed, true);
    const fencingStart = heartbeats.length;
    scoreGate = new Promise<void>((resolve) => { releaseScore = resolve; });
    const fencingEntered = new Promise<void>((resolve) => { scoreEntered = resolve; });
    const staleScan = failover.sample();
    await fencingEntered;
    Object.assign(vm, { haPromotion: { status: 'fenced' } });
    releaseScore();
    await staleScan;
    scoreGate = null;
    assert.equal(witnessArmed, false);
    assert.equal(heartbeats.slice(fencingStart).some((item) => !!item.plan), false,
      'a local fence established during validation cannot rearm the witness');
    Reflect.deleteProperty(vm, 'haPromotion');
    arch = 'arm64';
    await failover.sample();
    assert.equal(heartbeats.at(-1)?.plan, null, 'platform mismatch disarms witness');
    arch = 'x64';
    state = 'stopped';
    await failover.sample();
    assert.equal(heartbeats.at(-1)?.plan, null, 'planned stop disarms witness');
    policyEnabled = false;
    await failover.authorizeStart(id);
    assert.equal(starts, 1, 'persistent enrollment still requires witness');
  } finally {
    await failover.close();
    assert.equal(heartbeats.at(-1)?.plan, null, 'planned service close disarms witness');
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pending return heartbeats resume after source restart even with the HA policy revoked
 * 协作入口 / Collaborators: `randomUUID`, `failover.init`, `assert.deepEqual`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(heartbeats, [{ sourceHostId, sourceVmId: id, failureThreshold: 3, plan: null }])`; `assert.equal(failover.view(id).armed, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('pending return heartbeats resume after source restart even with the HA policy revoked', async () => {
  const id = randomUUID(), sourceHostId = randomUUID(), targetHostId = randomUUID();
  const vm = { id, snapshots: [] };
  const machines = { records: new Map([[id, vm]]), /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`vm`）。
   * Result: Return the branch-computed value (`vm`).
   * 验证场景 / Scenario: pending return heartbeats resume after source restart even with the HA policy revoked
   */
  get: () => vm,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: pending return heartbeats resume after source restart even with the HA policy revoked
     */
    state: () => 'running' } as unknown as Machines;
  const heartbeats: unknown[] = [];
  const client = { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ phase: 'source', armed: false, targetHostId, failureThreshold: 3, failback: {…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ phase: 'source', armed: false, targetHostId, failureThreshold: 3, failback: {…`) through a Promise.
   * 验证场景 / Scenario: pending return heartbeats resume after source restart even with the HA policy revoked
   */
  status: async () => ({ phase: 'source', armed: false,
    targetHostId, failureThreshold: 3, failback: { phase: 'pending' } }),
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: value: unknown。
     * 结果：返回受控对象，公开字段包括 `armed, failback`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `armed, failback`; the actual branch determines its shape.
     * 验证场景 / Scenario: pending return heartbeats resume after source restart even with the HA policy revoked
     * 协作入口 / Collaborators: `heartbeats.push`.
     */
    heartbeat: async (value: unknown) => {
      heartbeats.push(value); return { armed: false, failback: 'pending' };
    } } as unknown as HaWitnessClient;
  const peers = { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ hostId: sourceHostId })`）。
   * Result: Return the branch-computed value (`({ hostId: sourceHostId })`).
   * 验证场景 / Scenario: pending return heartbeats resume after source restart even with the HA policy revoked
   */
  view: () => ({ hostId: sourceHostId }) } as unknown as HostPeers;
  const failover = new HaHostFailover(machines, peers, {} as SnapshotReplications,
    async () => ({}), client);
  try {
    await failover.init();
    assert.deepEqual(heartbeats, [{ sourceHostId, sourceVmId: id, failureThreshold: 3, plan: null }]);
    assert.equal(failover.view(id).armed, false);
    assert.equal(failover.view(id).failback, 'pending', 'routing return remains visible separately from policy arming');
  } finally { await failover.close(); }
});
