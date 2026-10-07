/**
 * 模块职责：回归验证模块，围绕 `live-migration` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `live-migration`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: online migration check selects a paired target but never claims a safe transfer exists; online migration check reports incompatible or busy targets and source migration activity.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { planLiveMigration } from '../server/live-migration.ts';
import type { Machines } from '../server/machines.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { qmp } from '../server/qmp.ts';

const vmId = randomUUID(), localId = randomUUID(), peerId = randomUUID();
const machines = {
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ cpus: 2, memoryMiB: 1024 })`）。
   * Result: Return the branch-computed value (`({ cpus: 2, memoryMiB: 1024 })`).
   */
  get: () => ({ cpus: 2, memoryMiB: 1024 }),
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   */
  state: () => 'running',
  live: new Map([[vmId, { qmpPort: 1234, accelerator: 'tcg' }]]),
} as unknown as Machines;
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: arch = 'x64'; eligible = true。
 * 结果：返回分支计算值（`async () => ({ candidates: [ { id: localId, source: 'local', name: 'local', elig…`）。
 * Result: Return the branch-computed value (`async () => ({ candidates: [ { id: localId, source: 'local', name: 'local', elig…`).
 */
const score = (arch = 'x64', eligible = true) => async () => ({ candidates: [
  { id: localId, source: 'local', name: 'local', eligible: true, reasons: [],
    status: { platform: 'win32', arch: 'x64' } },
  { id: peerId, source: 'peer', name: 'remote', eligible,
    reasons: eligible ? [] : ['空闲内存不足'], status: { platform: 'win32', arch } },
] }) as Awaited<ReturnType<HostPeers['score']>>;
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: status = 'none'。
 * 结果：返回分支计算值（`(async (_port: number, command: string) => { if (command === 'query-status') ret…`）。
 * Result: Return the branch-computed value (`(async (_port: number, command: string) => { if (command === 'query-status') ret…`).
 */
const query = (status = 'none') => (async (_port: number, command: string) => {
  if (command === 'query-status') return { status: 'running', running: true };
  if (command === 'query-version') return { qemu: { major: 11, minor: 1, micro: 0 } };
  if (command === 'query-migrate') return { status };
  throw new Error('unexpected QMP query');
}) as typeof qmp;

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: online migration check selects a paired target but never claims a safe transfer exists
 * 协作入口 / Collaborators: `planLiveMigration`, `score`, `query`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.targetHostId, peerId)`; `assert.equal(result.ready, false)`.
 */
test('online migration check selects a paired target but never claims a safe transfer exists', async () => {
  const result = await planLiveMigration(machines, score(), vmId, {}, undefined, query());
  assert.equal(result.targetHostId, peerId);
  assert.equal(result.ready, false);
  assert.equal(result.executed, false);
  assert.equal(result.planned, true);
  assert.equal(result.steps.length, 5);
  assert.ok(result.blockers.some((item) => item.includes('磁盘脏块同步')));
  assert.ok(result.blockers.some((item) => item.includes('切换栅栏')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: online migration check reports incompatible or busy targets and source migration activity
 * 协作入口 / Collaborators: `planLiveMigration`, `score`, `query`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(result.blockers.some((item) => item.includes('内存不足')))`; `assert.ok(result.blockers.some((item) => item.includes('体系结构')))`.
 */
test('online migration check reports incompatible or busy targets and source migration activity', async () => {
  const result = await planLiveMigration(machines, score('arm64', false), vmId,
    { targetHostId: peerId }, undefined, query('active'));
  assert.ok(result.blockers.some((item) => item.includes('内存不足')));
  assert.ok(result.blockers.some((item) => item.includes('体系结构')));
  assert.ok(result.blockers.some((item) => item.includes('已存在迁移任务')));
  assert.equal(result.ready, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: online migration check prefers a compatible target over a higher scored incompatible peer
 * 协作入口 / Collaborators: `randomUUID`, `planLiveMigration`, `query`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.targetHostId, compatibleId)`; `assert.equal(result.ready, false)`.
 */
test('online migration check prefers a compatible target over a higher scored incompatible peer', async () => {
  const compatibleId = randomUUID();
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ candidates: [ { id: localId, source: 'local', name: 'local', eligible: true, …`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ candidates: [ { id: localId, source: 'local', name: 'local', eligible: true, …`) through a Promise.
   * 验证场景 / Scenario: online migration check prefers a compatible target over a higher scored incompatible peer
   */
  const withMixedPeers = async () => ({ candidates: [
    { id: localId, source: 'local', name: 'local', eligible: true, reasons: [],
      status: { platform: 'win32', arch: 'x64' } },
    { id: peerId, source: 'peer', name: 'incompatible', eligible: true, reasons: [],
      status: { platform: 'win32', arch: 'arm64' } },
    { id: compatibleId, source: 'peer', name: 'compatible', eligible: true, reasons: [],
      status: { platform: 'win32', arch: 'x64' } },
  ] }) as unknown as Awaited<ReturnType<HostPeers['score']>>;
  const result = await planLiveMigration(machines, withMixedPeers, vmId, {}, undefined, query());
  assert.equal(result.targetHostId, compatibleId);
  assert.equal(result.ready, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: online migration check preserves a missing peer as a blocker
 * 协作入口 / Collaborators: `randomUUID`, `planLiveMigration`, `score`, `query`.
 * 检查边界 / Checked boundaries: `assert.equal(result.targetHostId, missing)`; `assert.ok(result.blockers.some((item) => item.includes('未配对')))`.
 */
test('online migration check preserves a missing peer as a blocker', async () => {
  const missing = randomUUID();
  const result = await planLiveMigration(machines, score(), vmId,
    { targetHostId: missing }, undefined, query());
  assert.equal(result.targetHostId, missing);
  assert.ok(result.blockers.some((item) => item.includes('未配对')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: online migration check reports runnable only when the coordinator is wired
 * 协作入口 / Collaborators: `planLiveMigration`, `score`, `query`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ready, true)`; `assert.equal(result.executed, false)`.
 */
test('online migration check reports runnable only when the coordinator is wired', async () => {
  const result = await planLiveMigration(machines, score(), vmId,
    { targetHostId: peerId }, undefined, query(), true);
  assert.equal(result.ready, true);
  assert.equal(result.executed, false);
  assert.equal(result.targetHostId, peerId);
  assert.deepEqual(result.blockers, []);
});
