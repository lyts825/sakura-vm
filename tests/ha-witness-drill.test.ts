/**
 * 模块职责：回归验证模块，围绕 `ha-witness-drill` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-witness-drill`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: drill success needs authenticated source refusal, exact target, health and confirmed routing together; unavailable or transitioning reads cannot prove a fence or a split-brain violation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assessHaDrillSample, type HaDrillPlan, type HaDrillSample } from '../server/ha-witness-drill.ts';

const replica = { sourceHostId: randomUUID(), sourceVmId: randomUUID(), targetHostId: randomUUID(),
  transferId: randomUUID(), remoteVmId: randomUUID(), snapshotId: randomUUID(), sha256: 'a'.repeat(64),
  snapshotAt: new Date().toISOString(), maxReplicaAgeMinutes: 60 };
const plan: HaDrillPlan = { version: 1, kind: 'sakura-ha-drill-plan', drillId: randomUUID(),
  createdAt: new Date().toISOString(), witnessNode: 'fixture', configDigest: 'b'.repeat(64),
  sourceSystemUuid: randomUUID(), failureThreshold: 2, replica,
  endpoints: { witness: 'https://witness.invalid/', redfishSystem: 'https://bmc.invalid/redfish/v1/Systems/1',
    target: 'https://target.invalid/', application: 'https://app.invalid/health', traffic: 'https://traffic.invalid/' },
  operatorSteps: ['Review the real hardware identities before fault injection.'] };
const healthy: HaDrillSample = { at: new Date().toISOString(), ok: true, stable: true,
  phase: 'promoted', planMatches: true, sourceStartAllowed: false,
  observed: { powerState: 'Off', targetHostId: replica.targetHostId, targetVmId: replica.remoteVmId,
    targetStatus: 'running', applicationVmId: replica.remoteVmId, applicationReady: true,
    activeVmId: replica.remoteVmId } };

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: drill success needs authenticated source refusal, exact target, health and confirmed routing together
 * 协作入口 / Collaborators: `assert.equal`, `assessHaDrillSample`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.equal(assessHaDrillSample(plan, healthy).complete, true)`; `assert.equal(assessHaDrillSample(plan, sample).complete, false)`.
 */
test('drill success needs authenticated source refusal, exact target, health and confirmed routing together', () => {
  assert.equal(assessHaDrillSample(plan, healthy).complete, true);
  for (const sample of [
    { ...healthy, ok: false }, { ...healthy, sourceStartAllowed: undefined },
    { ...healthy, observed: { ...healthy.observed, powerState: undefined } },
    { ...healthy, observed: { ...healthy.observed, targetHostId: randomUUID() } },
    { ...healthy, observed: { ...healthy.observed, targetVmId: randomUUID() } },
    { ...healthy, observed: { ...healthy.observed, targetStatus: 'starting' as const } },
    { ...healthy, observed: { ...healthy.observed, applicationReady: false } },
    { ...healthy, observed: { ...healthy.observed, activeVmId: replica.sourceVmId } },
  ]) assert.equal(assessHaDrillSample(plan, sample).complete, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unavailable or transitioning reads cannot prove a fence or a split-brain violation
 * 协作入口 / Collaborators: `assert.deepEqual`, `assessHaDrillSample`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(assessHaDrillSample(plan, { at: healthy.at, ok: false, stable: false, error: 'TLS connection refused' }), { compl…`; `assert.deepEqual(assessHaDrillSample(plan, { ...healthy, stable: false, phase: 'source', sourceStartAllowed: true, observed: { ...…`.
 */
test('unavailable or transitioning reads cannot prove a fence or a split-brain violation', () => {
  assert.deepEqual(assessHaDrillSample(plan, { at: healthy.at, ok: false, stable: false,
    error: 'TLS connection refused' }), { complete: false, violation: null });
  assert.deepEqual(assessHaDrillSample(plan, { ...healthy, stable: false, phase: 'source',
    sourceStartAllowed: true, observed: { ...healthy.observed, powerState: 'On' } }),
  { complete: false, violation: null });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stable unsafe authority, early target starts, a revived source and changed plans fail the drill
 * 协作入口 / Collaborators: `assessHaDrillSample`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.complete, false)`; `assert.equal(typeof result.violation, 'string')`.
 */
test('stable unsafe authority, early target starts, a revived source and changed plans fail the drill', () => {
  for (const sample of [
    { ...healthy, sourceStartAllowed: true },
    { ...healthy, phase: 'fencing' },
    { ...healthy, phase: 'fenced', observed: { ...healthy.observed, powerState: 'On' } },
    { ...healthy, planMatches: false },
  ]) {
    const result = assessHaDrillSample(plan, sample);
    assert.equal(result.complete, false);
    assert.equal(typeof result.violation, 'string');
  }
});
