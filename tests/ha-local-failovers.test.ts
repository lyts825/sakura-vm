/**
 * 模块职责：回归验证模块，围绕 `ha-local-failovers` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-local-failovers`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: process-only takeover fences source before promotion and retires target before rejoin; a witness-enrolled source needs serialized disarm before local fencing and every pending retry.
 */
const witnessGuards: { disarmWitness?: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: id: string; failureThreshold: number。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(id: string, failureThreshold: number) => Promise<void> } = {};
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';
import type { HaFailureMonitor } from '../server/ha-failure-monitor.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { SnapshotReplications } from '../server/snapshot-replications.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-ha-local-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { HaLocalFailovers } = await import('../server/ha-local-failovers.ts');
const { createSchema } = await import('../server/model.ts');
after(async () => {
  const path = await realpath(root);
  if (!basename(path).startsWith('sakura-ha-local-') || resolve(path) === resolve(tmpdir()))
    throw new Error('unsafe local HA cleanup');
  await rm(path, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
 * 状态影响 / State effects: `targetStatus`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `'a'.repeat`, `new Date().toISOString`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.start(targetId), { code: 'HA_REPLICA_STANDBY' })`; `assert.rejects( machines.startHaReplica(targetId, { sourceHostId, transferId, sourceVmId: sourceId, snapshotId, sha256: 'b'.repeat…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('process-only takeover fences source before promotion and retires target before rejoin', async () => {
  const engine = { runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
   */
  close: async () => {} } } as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const sourceId = randomUUID(),
    targetId = randomUUID();
  const snapshotId = randomUUID(),
    transferId = randomUUID();
  const peerId = randomUUID(),
    targetHostId = randomUUID(),
    sourceHostId = randomUUID();
  const sha256 = 'a'.repeat(64),
    now = new Date().toISOString();
  machines.records.set(sourceId, {
    ...createSchema.parse({ name: 'source' }),
    id: sourceId,
    createdAt: now,
    snapshots: [{ id: snapshotId, name: 'standby', createdAt: now }],
    lastError: 'QEMU exited unexpectedly',
  });
  machines.records.set(targetId, {
    ...createSchema.parse({ name: 'standby' }),
    id: targetId,
    createdAt: now,
    snapshots: [],
    migrationOrigin: {
      sourceHostId,
      transferId,
      targetName: 'standby',
      sourceVmId: sourceId,
      snapshotId,
      diskSha256: sha256,
    },
  });
  await assert.rejects(machines.start(targetId), { code: 'HA_REPLICA_STANDBY' });
  await assert.rejects(
    machines.startHaReplica(targetId, {
      sourceHostId,
      transferId,
      sourceVmId: sourceId,
      snapshotId,
      sha256: 'b'.repeat(64),
    }),
    { code: 'HA_REPLICA_STANDBY' },
  );
  let suspected = true,
    starts = 0,
    retires = 0,
    failStartOnce = true;
  let targetStatus: 'stopped' | 'starting' | 'running' = 'stopped';
  const monitor = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ suspected })`）。
     * Result: Return the branch-computed value (`({ suspected })`).
     * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
     */
    view: () => ({ suspected }),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
     * 状态影响 / State effects: `suspected`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    reconfigure: async () => {
      suspected = false;
    },
  } as unknown as HaFailureMonitor;
  const peers = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ candidates: [ { id: sourceHostId, source: 'local', status: { platform: 'win32…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ candidates: [ { id: sourceHostId, source: 'local', status: { platform: 'win32…`) through a Promise.
     * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
     * 协作入口 / Collaborators: `Date.now`.
     */
    score: async () => ({
      candidates: [
        { id: sourceHostId, source: 'local', status: { platform: 'win32', arch: 'x64' } },
        {
          id: targetHostId,
          source: 'peer',
          name: 'standby',
          eligible: true,
          reasons: [],
          observedAt: Date.now(),
          status: { platform: 'win32', arch: 'x64' },
        },
      ],
    }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ outbound: [{ id: peerId, remoteId: targetHostId }] })`）。
     * Result: Return the branch-computed value (`({ outbound: [{ id: peerId, remoteId: targetHostId }] })`).
     * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
     */
    view: () => ({ outbound: [{ id: peerId, remoteId: targetHostId }] }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: targetId, sha256, sourceVmId: sourceId, snapshotId })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ id: targetId, sha256, sourceVmId: sourceId, snapshotId })`) through a Promise.
     * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
     */
    importStatus: async () => ({ id: targetId, sha256, sourceVmId: sourceId, snapshotId }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ready: true, id: targetId, status: targetStatus })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ready: true, id: targetId, status: targetStatus })`) through a Promise.
     * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
     */
    checkReplicaActivation: async () => ({ ready: true, id: targetId, status: targetStatus }),
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `id, status`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id, status`; the actual branch determines its shape.
     * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
     * 状态影响 / State effects: `failStartOnce`, `targetStatus`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('standby unavailable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `JSON.parse`, `readFile`, `join`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(saved.find((vm: { id: string }) => vm.id === sourceId).haPromotion.transferId, transferId)`.
     */
    activateReplica: async () => {
      const saved = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
      assert.equal(saved.find((vm: { id: string }) => vm.id === sourceId).haPromotion.transferId, transferId);
      starts++;
      if (failStartOnce) {
        failStartOnce = false;
        throw new Error('standby unavailable');
      }
      targetStatus = 'starting';
      return { id: targetId, status: targetStatus };
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `id, retired`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id, retired`; the actual branch determines its shape.
     * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
     * 协作入口 / Collaborators: `machines.retireHaReplica`.
     */
    retireReplica: async () => {
      retires++;
      await machines.retireHaReplica(targetId, {
        sourceHostId,
        transferId,
        sourceVmId: sourceId,
        snapshotId,
        sha256,
      });
      return { id: targetId, retired: true };
    },
  } as unknown as HostPeers;
  const replications = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ entries: [ { vmId: sourceId, peerId, snapshotId, transferId, remoteVmId: targ…`）。
     * Result: Return the branch-computed value (`({ entries: [ { vmId: sourceId, peerId, snapshotId, transferId, remoteVmId: targ…`).
     * 验证场景 / Scenario: process-only takeover fences source before promotion and retires target before rejoin
     */
    view: () => ({
      entries: [
        {
          vmId: sourceId,
          peerId,
          snapshotId,
          transferId,
          remoteVmId: targetId,
          sha256,
          status: 'replicated',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  } as unknown as SnapshotReplications;
  const policy = { enabled: true, options: { targetHostId, autoProcessFailover: true } };
  const failover = new HaLocalFailovers(
    machines,
    monitor,
    peers,
    replications,
    async () => ({ [sourceId]: policy }),
    undefined,
    witnessGuards,
  );
  try {
    await failover.init();
    assert.equal(starts, 0, 'persisted suspicion alone is not process-exit evidence');
    machines.live.set(sourceId, { status: 'running' } as never);
    machines.emit('change');
    machines.live.delete(sourceId);
    await failover.sample();
    assert.equal(starts, 1);
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    await assert.rejects(machines.start(sourceId), { code: 'HA_SOURCE_FENCED' });
    await failover.sample();
    assert.equal(starts, 2);
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    assert.equal(machines.get(sourceId).haPromotion?.error, undefined);
    await failover.sample();
    assert.equal(starts, 2, 'a starting standby is observed rather than started again');
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    const waiting = new Machines(engine, fakeVmNetwork);
    await waiting.init();
    try {
      assert.equal(waiting.get(sourceId).haPromotion?.status, 'fenced');
      await assert.rejects(waiting.start(sourceId), { code: 'HA_SOURCE_FENCED' });
    } finally {
      await waiting.close();
    }
    targetStatus = 'running';
    await failover.sample();
    assert.equal(machines.get(sourceId).haPromotion?.status, 'accepted');
    await assert.rejects(machines.start(sourceId), { code: 'HA_SOURCE_FENCED' });
    const reopened = new Machines(engine, fakeVmNetwork);
    await reopened.init();
    try {
      await assert.rejects(reopened.start(sourceId), { code: 'HA_SOURCE_FENCED' });
    } finally {
      await reopened.close();
    }
    machines.live.set(targetId, { status: 'running' } as never);
    await assert.rejects(failover.rejoin(sourceId, true), /请先停止/);
    assert.ok(machines.get(sourceId).haPromotion);
    machines.live.delete(targetId);
    await assert.rejects(failover.rejoin(sourceId, false), /请先回迁/);
    assert.equal((await failover.rejoin(sourceId, true)).executed, true);
    assert.equal(retires, 2);
    assert.equal(machines.get(sourceId).haPromotion, undefined);
    assert.ok(machines.get(targetId).haRetirement);
    await assert.rejects(machines.start(targetId), { code: 'HA_REPLICA_RETIRED' });
    const final = new Machines(engine, fakeVmNetwork);
    await final.init();
    try {
      assert.equal(final.get(sourceId).haPromotion, undefined);
      await assert.rejects(final.start(targetId), { code: 'HA_REPLICA_RETIRED' });
    } finally {
      await final.close();
    }
  } finally {
    await failover.close();
    machines.live.clear();
    await machines.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
 * 状态影响 / State effects: `witnessGuards.disarmWitness`, `policy.enabled`, `calls.length`, `checkGate`, `targetStatus`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `'c'.repeat`, `new Date().toISOString`.
 * 检查边界 / Checked boundaries: `assert.match(failover.view(sourceId).error || '', /见证撤防校验不可用/)`; `assert.equal(machines.get(sourceId).haPromotion, undefined)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a witness-enrolled source needs serialized disarm before local fencing and every pending retry', async () => {
  const machines = new Machines({ runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
   */
  close: async () => {} } } as Engine, fakeVmNetwork);
  await machines.init();
  const sourceId = randomUUID(),
    targetId = randomUUID(),
    sourceHostId = randomUUID();
  const targetHostId = randomUUID(),
    snapshotId = randomUUID(),
    transferId = randomUUID(),
    peerId = randomUUID();
  const sha256 = 'c'.repeat(64),
    now = new Date().toISOString();
  machines.records.set(sourceId, {
    ...createSchema.parse({ name: 'witness-arbitration' }),
    id: sourceId,
    createdAt: now,
    snapshots: [{ id: snapshotId, name: 'standby', createdAt: now }],
    lastError: 'QEMU exited unexpectedly',
    haWitnessEnrollment: { targetHostId, failureThreshold: 3, registeredAt: now },
  });
  const calls: string[] = [];
  let targetStatus: 'stopped' | 'starting' | 'running' = 'stopped';
  let checkGate: Promise<void> | null = null,
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     */
    checkEntered = () => {};
  const peers = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ candidates: [ { id: sourceHostId, source: 'local', status: { platform: 'win32…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ candidates: [ { id: sourceHostId, source: 'local', status: { platform: 'win32…`) through a Promise.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     * 协作入口 / Collaborators: `Date.now`.
     */
    score: async () => ({
      candidates: [
        { id: sourceHostId, source: 'local', status: { platform: 'win32', arch: 'x64' } },
        {
          id: targetHostId,
          source: 'peer',
          name: 'standby',
          eligible: true,
          reasons: [],
          observedAt: Date.now(),
          status: { platform: 'win32', arch: 'x64' },
        },
      ],
    }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ outbound: [{ id: peerId, remoteId: targetHostId }] })`）。
     * Result: Return the branch-computed value (`({ outbound: [{ id: peerId, remoteId: targetHostId }] })`).
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     */
    view: () => ({ outbound: [{ id: peerId, remoteId: targetHostId }] }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: targetId, sha256, sourceVmId: sourceId, snapshotId })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ id: targetId, sha256, sourceVmId: sourceId, snapshotId })`) through a Promise.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     */
    importStatus: async () => ({ id: targetId, sha256, sourceVmId: sourceId, snapshotId }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `ready, id, status`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `ready, id, status`; the actual branch determines its shape.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     * 协作入口 / Collaborators: `calls.push`, `machines.get`, `checkEntered`.
     */
    checkReplicaActivation: async () => {
      calls.push('target-check');
      if (checkGate && machines.get(sourceId).haPromotion) {
        checkEntered();
        await checkGate;
      }
      return { ready: true, id: targetId, status: targetStatus };
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `id, status`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id, status`; the actual branch determines its shape.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     * 状态影响 / State effects: `targetStatus`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `JSON.parse`, `readFile`, `join`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(saved.find((vm: { id: string }) => vm.id === sourceId).haPromotion.transferId, transferId)`.
     */
    activateReplica: async () => {
      const saved = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
      assert.equal(saved.find((vm: { id: string }) => vm.id === sourceId).haPromotion.transferId, transferId);
      calls.push('activate');
      targetStatus = 'starting';
      return { id: targetId, status: targetStatus };
    },
  } as unknown as HostPeers;
  const monitor = { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ suspected: true })`）。
   * Result: Return the branch-computed value (`({ suspected: true })`).
   * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
   */
  view: () => ({ suspected: true }) } as unknown as HaFailureMonitor;
  const replications = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ entries: [ { vmId: sourceId, peerId, snapshotId, transferId, remoteVmId: targ…`）。
     * Result: Return the branch-computed value (`({ entries: [ { vmId: sourceId, peerId, snapshotId, transferId, remoteVmId: targ…`).
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     */
    view: () => ({
      entries: [
        {
          vmId: sourceId,
          peerId,
          snapshotId,
          transferId,
          remoteVmId: targetId,
          sha256,
          status: 'replicated',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  } as unknown as SnapshotReplications;
  const policy = {
    enabled: true,
    options: { targetHostId, failureThreshold: 3, autoProcessFailover: true, autoHostFailover: true },
  };
  let failover = new HaLocalFailovers(
    machines,
    monitor,
    peers,
    replications,
    async () => ({ [sourceId]: policy }),
    undefined,
    witnessGuards,
  );
  try {
    await failover.init();
    machines.live.set(sourceId, { status: 'running' } as never);
    machines.emit('change');
    machines.live.delete(sourceId);
    await failover.sample();
    assert.match(failover.view(sourceId).error || '', /见证撤防校验不可用/);
    assert.equal(machines.get(sourceId).haPromotion, undefined);
    assert.equal(calls.includes('activate'), false);
    witnessGuards.disarmWitness = /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     * 失败 / Failure: `new Error('witness already fencing')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => {
      throw new Error('witness already fencing');
    };
    await failover.sample();
    assert.match(failover.view(sourceId).error || '', /already fencing/);
    assert.equal(machines.get(sourceId).haPromotion, undefined);
    assert.equal(calls.includes('activate'), false);
    let /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     */
    releaseDisarm = () => {},
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
       */
      disarmEntered = () => {};
    let disarmGate = new Promise<void>((done) => {
      releaseDisarm = done;
    });
    let entered = new Promise<void>((done) => {
      disarmEntered = done;
    });
    witnessGuards.disarmWitness = /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     * 协作入口 / Collaborators: `disarmEntered`.
     */
    async () => {
      disarmEntered();
      await disarmGate;
    };
    const policyChanging = failover.sample();
    await entered;
    policy.enabled = false;
    releaseDisarm();
    await policyChanging;
    assert.match(failover.view(sourceId).error || '', /策略已变化/);
    assert.equal(
      machines.get(sourceId).haPromotion,
      undefined,
      'a strategy disabled while withdrawal waits cannot persist a local fence',
    );
    assert.equal(calls.includes('activate'), false);
    policy.enabled = true;
    witnessGuards.disarmWitness = /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: id; threshold。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     * 协作入口 / Collaborators: `assert.equal`, `machines.get`, `calls.push`.
     * 检查边界 / Checked boundaries: `assert.equal(id, sourceId)`; `assert.equal(threshold, 3)`.
     */
    async (id, threshold) => {
      assert.equal(id, sourceId);
      assert.equal(threshold, 3);
      assert.equal(machines.get(sourceId).haPromotion, undefined);
      calls.push('disarm');
    };
    calls.length = 0;
    await failover.sample();
    assert.equal(calls.includes('disarm'), true);
    assert.ok(calls.indexOf('disarm') < calls.indexOf('activate'));
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    assert.equal(calls.filter((call) => call === 'activate').length, 1);
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     */
    let releaseCheck = () => {};
    checkGate = new Promise<void>((done) => {
      releaseCheck = done;
    });
    const checked = new Promise<void>((done) => {
      checkEntered = done;
    });
    witnessGuards.disarmWitness = /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     * 协作入口 / Collaborators: `calls.push`.
     */
    async () => {
      calls.push('check-disarm');
    };
    targetStatus = 'stopped';
    calls.length = 0;
    const checking = failover.sample();
    await checked;
    policy.options.autoProcessFailover = false;
    releaseCheck();
    await checking;
    assert.equal(
      calls.includes('activate'),
      false,
      'a policy disabled during slow target inspection cannot start the standby',
    );
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    assert.match(machines.get(sourceId).haPromotion?.error || '', /策略已变化/);
    policy.options.autoProcessFailover = true;
    checkGate = null;
    targetStatus = 'starting';
    witnessGuards.disarmWitness = /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     * 失败 / Failure: `new Error('witness unavailable during retry')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => {
      throw new Error('witness unavailable during retry');
    };
    calls.length = 0;
    await failover.sample();
    assert.equal(calls.includes('activate'), false);
    assert.equal(
      calls.includes('target-check'),
      false,
      'an existing pending local fence cannot bypass the witness on a new run',
    );
    assert.match(machines.get(sourceId).haPromotion?.error || '', /unavailable during retry/);
    disarmGate = new Promise<void>((done) => {
      releaseDisarm = done;
    });
    entered = new Promise<void>((done) => {
      disarmEntered = done;
    });
    witnessGuards.disarmWitness = /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     * 协作入口 / Collaborators: `disarmEntered`.
     */
    async () => {
      disarmEntered();
      await disarmGate;
    };
    const changingTarget = failover.sample();
    await entered;
    policy.options.targetHostId = randomUUID();
    releaseDisarm();
    await changingTarget;
    assert.equal(
      calls.includes('target-check'),
      false,
      'pending retries recheck the durable target after witness withdrawal',
    );
    assert.match(machines.get(sourceId).haPromotion?.error || '', /策略已变化/);
    policy.options.targetHostId = targetHostId;
    disarmGate = new Promise<void>((done) => {
      releaseDisarm = done;
    });
    entered = new Promise<void>((done) => {
      disarmEntered = done;
    });
    const stopping = failover.sample();
    await entered;
    const stopped = failover.close();
    releaseDisarm();
    await Promise.all([stopping, stopped]);
    assert.equal(
      calls.includes('target-check'),
      false,
      'service shutdown during withdrawal cannot touch the target',
    );
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    failover = new HaLocalFailovers(
      machines,
      monitor,
      peers,
      replications,
      async () => ({ [sourceId]: policy }),
      undefined,
      witnessGuards,
    );
    witnessGuards.disarmWitness = /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a witness-enrolled source needs serialized disarm before local fencing and every pending retry
     * 协作入口 / Collaborators: `calls.push`.
     */
    async () => {
      calls.push('retry-disarm');
    };
    targetStatus = 'running';
    await failover.init();
    assert.equal(calls[0], 'retry-disarm');
    assert.equal(machines.get(sourceId).haPromotion?.status, 'accepted');
  } finally {
    await failover.close();
    machines.live.clear();
    await machines.close();
  }
});
