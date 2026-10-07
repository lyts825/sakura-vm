/**
 * 模块职责：回归验证模块，围绕 `live-migration-receiver` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `live-migration-receiver`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: target completion binds the session and transfer, then permits idempotent readiness polling; target abort requires the original session and a still-prepared receiver.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LiveMigrationReceiver } from '../server/live-migration-receiver.ts';
import type { Machines } from '../server/machines.ts';
import { HostPeers } from '../server/host-peers.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: target completion binds the session and transfer, then permits idempotent readiness polling
 * 状态影响 / State effects: `origin.status`, `state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `new Date().toISOString`, `assert.throws`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.throws(() => receiver.status({ requesterId: randomUUID(), transferId, targetVmId }), /身份不匹配/)`; `assert.rejects(receiver.complete({ requesterId, transferId, targetVmId, sessionId: randomUUID() }), /会话与目标实例不匹配/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('target completion binds the session and transfer, then permits idempotent readiness polling', async () => {
  const requesterId = randomUUID(), transferId = randomUUID();
  const targetVmId = randomUUID(), sessionId = randomUUID();
  const origin = { sourceHostId: requesterId, sourceVmId: randomUUID(),
    transferId, status: 'prepared', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString() };
  const vm = { id: targetVmId, liveMigrationOrigin: origin };
  let state: 'paused' | 'starting' | 'running' = 'paused';
  let completes = 0, closes = 0;
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     * 验证场景 / Scenario: target completion binds the session and transfer, then permits idempotent readiness polling
     * 失败 / Failure: `new Error('wrong target')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    get: (id: string) => {
      if (id !== targetVmId) throw new Error('wrong target');
      return vm;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`state`）。
     * Result: Return the branch-computed value (`state`).
     * 验证场景 / Scenario: target completion binds the session and transfer, then permits idempotent readiness polling
     */
    state: () => state,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: target completion binds the session and transfer, then permits idempotent readiness polling
     * 状态影响 / State effects: `origin.status`, `state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    completeIncoming: async () => { completes++; origin.status = 'received'; state = 'starting'; },
  } as unknown as Machines;
  const peers = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: session: string; requester: string; target: string; transfer: string。
     * 结果：返回分支计算值（`session === sessionId && requester === requesterId && target === targetVmId && t…`）。
     * Result: Return the branch-computed value (`session === sessionId && requester === requesterId && target === targetVmId && t…`).
     * 验证场景 / Scenario: target completion binds the session and transfer, then permits idempotent readiness polling
     */
    matchesMigrationSession: (session: string, requester: string, target: string,
      transfer: string) => session === sessionId && requester === requesterId &&
        target === targetVmId && transfer === transferId,
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: target completion binds the session and transfer, then permits idempotent readiness polling
     */
    closeMigrationSession: () => { closes++; },
  } as unknown as HostPeers;
  const receiver = new LiveMigrationReceiver(machines, peers);
  assert.throws(() => receiver.status({ requesterId: randomUUID(), transferId, targetVmId }),
    /身份不匹配/);
  await assert.rejects(receiver.complete({ requesterId, transferId, targetVmId,
    sessionId: randomUUID() }), /会话与目标实例不匹配/);
  assert.equal(completes, 0);
  assert.deepEqual(await receiver.complete({ requesterId, transferId, targetVmId, sessionId }),
    { targetVmId, status: 'starting', originStatus: 'received' });
  assert.equal(completes, 1);
  assert.equal(closes, 1);
  assert.equal((await receiver.complete({ requesterId, transferId, targetVmId,
    sessionId })).originStatus, 'received');
  assert.equal(completes, 1);
  origin.status = 'ready';
  state = 'running';
  assert.deepEqual(receiver.status({ requesterId, transferId, targetVmId }),
    { targetVmId, status: 'running', originStatus: 'ready' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: target abort requires the original session and a still-prepared receiver
 * 状态影响 / State effects: `origin.status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `assert.rejects`, `receiver.abort`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(receiver.abort({ requesterId, transferId, targetVmId, sessionId: randomUUID(), sourceRunning: true }), /会话与目标实例不匹配/…`; `assert.deepEqual([closes, stops, deletes], [0, 0, 0])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('target abort requires the original session and a still-prepared receiver', async () => {
  const requesterId = randomUUID(), transferId = randomUUID();
  const targetVmId = randomUUID(), sessionId = randomUUID();
  const origin = { sourceHostId: requesterId, transferId, status: 'prepared' };
  let closes = 0, stops = 0, deletes = 0;
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: targetVmId, liveMigrationOrigin: origin })`）。
     * Result: Return the branch-computed value (`({ id: targetVmId, liveMigrationOrigin: origin })`).
     * 验证场景 / Scenario: target abort requires the original session and a still-prepared receiver
     */
    get: () => ({ id: targetVmId, liveMigrationOrigin: origin }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'stopped'`）。
     * Result: Return the branch-computed value (`'stopped'`).
     * 验证场景 / Scenario: target abort requires the original session and a still-prepared receiver
     */
    state: () => 'stopped',
    live: new Map(),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: target abort requires the original session and a still-prepared receiver
     */
    stop: async () => { stops++; },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: target abort requires the original session and a still-prepared receiver
     */
    delete: async () => { deletes++; },
  } as unknown as Machines;
  const peers = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: session: string。
     * 结果：返回分支计算值（`session === sessionId`）。
     * Result: Return the branch-computed value (`session === sessionId`).
     * 验证场景 / Scenario: target abort requires the original session and a still-prepared receiver
     */
    matchesMigrationSession: (session: string) => session === sessionId,
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: target abort requires the original session and a still-prepared receiver
     */
    closeMigrationSession: () => { closes++; },
  } as unknown as HostPeers;
  const receiver = new LiveMigrationReceiver(machines, peers);
  await assert.rejects(receiver.abort({ requesterId, transferId, targetVmId,
    sessionId: randomUUID(), sourceRunning: true }), /会话与目标实例不匹配/);
  assert.deepEqual([closes, stops, deletes], [0, 0, 0]);
  origin.status = 'received';
  await assert.rejects(receiver.abort({ requesterId, transferId, targetVmId,
    sessionId, sourceRunning: true }), /已接收迁移/);
  assert.deepEqual([closes, stops, deletes], [0, 0, 0]);
  origin.status = 'prepared';
  assert.deepEqual(await receiver.abort({ requesterId, transferId, targetVmId,
    sessionId, sourceRunning: true }), { targetVmId, aborted: true });
  assert.deepEqual([closes, stops, deletes], [1, 1, 1]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: public peer callers cannot forge a stopped-source declaration to cold-start a target
 * 协作入口 / Collaborators: `assert.rejects`, `peers.completeLiveTarget`, `randomUUID`, `receiver.complete`.
 * 检查边界 / Checked boundaries: `assert.rejects(peers.completeLiveTarget(randomUUID(), { targetVmId: randomUUID(), transferId: randomUUID(), sessionId: randomUUID(…`; `assert.rejects(receiver.complete({ requesterId: randomUUID(), targetVmId: randomUUID(), transferId: randomUUID(), sessionId: rando…`.
 */
test('public peer callers cannot forge a stopped-source declaration to cold-start a target', async () => {
  const peers = new HostPeers(async () => ({ platform: process.platform, arch: process.arch,
    cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
    load: [0, 0, 0], vmCount: 0, runningVms: 0 }));
  await assert.rejects(peers.completeLiveTarget(randomUUID(), { targetVmId: randomUUID(),
    transferId: randomUUID(), sessionId: randomUUID(), sourceStopped: true }),
  { status: 403, code: 'LIVE_MIGRATION_SYSTEM_ONLY' });
  const receiver = new LiveMigrationReceiver({} as Machines, peers);
  await assert.rejects(receiver.complete({ requesterId: randomUUID(), targetVmId: randomUUID(),
    transferId: randomUUID(), sessionId: randomUUID(), sourceStopped: true }),
  { status: 403, code: 'LIVE_MIGRATION_SYSTEM_ONLY' });
});
