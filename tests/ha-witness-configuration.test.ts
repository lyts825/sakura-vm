/**
 * 模块职责：回归验证模块，围绕 `ha-witness-configuration` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-witness-configuration`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: HA policy enrollment and revocation follow witness acknowledgments.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';
import type { Workspaces } from '../server/workspaces.ts';
import type { HaHostFailover } from '../server/ha-host-failover.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-ha-config-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { NextFeatures } = await import('../server/next-features.ts');
const { createSchema } = await import('../server/model.ts');
after(async () => {
  const path = await realpath(root);
  if (!basename(path).startsWith('sakura-ha-config-') ||
      resolve(path) === resolve(tmpdir())) throw new Error('unsafe HA configuration cleanup');
  await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HA policy enrollment and revocation follow witness acknowledgments
 * 状态影响 / State effects: `hostFailover`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `machines.records.set`, `createSchema.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(machines.get(id).haWitnessEnrollment?.targetHostId, targetHostId)`; `assert.equal(restored.get(id).haWitnessEnrollment?.failureThreshold, 3)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('HA policy enrollment and revocation follow witness acknowledgments', async () => {
  const machines = new Machines({ runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: HA policy enrollment and revocation follow witness acknowledgments
   */
  close: async () => {} } } as Engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID(), targetHostId = randomUUID();
  machines.records.set(id, { ...createSchema.parse({ name: 'ha-policy' }),
    id, createdAt: new Date().toISOString(), snapshots: [] });
  const workspaces = { /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`() => {}`）。
   * Result: Return the branch-computed value (`() => {}`).
   * 验证场景 / Scenario: HA policy enrollment and revocation follow witness acknowledgments
   */
  beforeConfigChange: () => () => {},
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'default'`）。
     * Result: Return the branch-computed value (`'default'`).
     * 验证场景 / Scenario: HA policy enrollment and revocation follow witness acknowledgments
     */
    current: () => 'default', /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`id`）。
     * Result: Return the branch-computed value (`id`).
     * 验证场景 / Scenario: HA policy enrollment and revocation follow witness acknowledgments
     */
    key: () => id } } as unknown as Workspaces;
  let hostFailover: HaHostFailover | undefined;
  const features = new NextFeatures(machines, workspaces, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: id。
   * 结果：返回分支计算值（`(id === 'haHostFailover' ? hostFailover : undefined) as never`）。
   * Result: Return the branch-computed value (`(id === 'haHostFailover' ? hostFailover : undefined) as never`).
   * 验证场景 / Scenario: HA policy enrollment and revocation follow witness acknowledgments
   */
  optional: id => (id === 'haHostFailover' ? hostFailover : undefined) as never });
  const disarmed: string[] = [];
  hostFailover = {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     * 验证场景 / Scenario: HA policy enrollment and revocation follow witness acknowledgments
     */
    configured: () => true,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ configured: true, phase: 'source', targetHostId, failureThreshold: 3, armed: …`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ configured: true, phase: 'source', targetHostId, failureThreshold: 3, armed: …`) through a Promise.
     * 验证场景 / Scenario: HA policy enrollment and revocation follow witness acknowledgments
     */
    witnessStatus: async () => ({ configured: true, phase: 'source',
      targetHostId, failureThreshold: 3, armed: false }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; threshold: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: HA policy enrollment and revocation follow witness acknowledgments
     * 协作入口 / Collaborators: `disarmed.push`.
     */
    disarm: async (_id: string, threshold: number) => { disarmed.push(`${_id}:${threshold}`); },
  } as unknown as HaHostFailover;
  try {
    await features.configure(id, { featureId: 'ha-failover', enabled: true,
      options: { targetHostId, failureThreshold: 3, autoHostFailover: true } });
    assert.equal(machines.get(id).haWitnessEnrollment?.targetHostId, targetHostId);
    const restored = new Machines({ runtime: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: HA policy enrollment and revocation follow witness acknowledgments
     */
    close: async () => {} } } as Engine, fakeVmNetwork);
    await restored.init();
    try { assert.equal(restored.get(id).haWitnessEnrollment?.failureThreshold, 3); }
    finally { await restored.close(); }
    await assert.rejects(features.configure(id, { featureId: 'ha-failover',
      enabled: true, options: { targetHostId: randomUUID(), failureThreshold: 3,
        autoHostFailover: true } }), /先关闭/);
    assert.deepEqual(disarmed, []);
    await features.configure(id, { featureId: 'ha-failover', enabled: false,
      options: { targetHostId, failureThreshold: 3, autoHostFailover: false } });
    assert.deepEqual(disarmed, [`${id}:3`]);
    assert.equal(machines.get(id).haWitnessEnrollment, undefined);
  } finally {
    await features.close();
    await machines.close();
  }
});
