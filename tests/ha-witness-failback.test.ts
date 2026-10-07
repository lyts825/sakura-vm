/**
 * 模块职责：回归验证模块，围绕 `ha-witness-failback` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-witness-failback`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: failback releases only a retired target, persists exact identity and waits for source health; a restored route with a lost response resumes after restart without a second restore write.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import { join, resolve } from 'node:path';
import { generate } from 'selfsigned';
import { HaWitness, type HaWitnessActions } from '../server/ha-witness-core.ts';
import { HaWitnessClient } from '../server/ha-witness-client.ts';
import { startHaWitnessServer, witnessVms } from '../server/ha-witness-server.ts';
import { checkHaWitnessDeployment } from '../server/ha-witness-preflight.ts';

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: label: string。
 * 结果：返回分支计算值（`mkdtemp(join(parent, `${label}-`))`），以 Promise 交付。
 * Result: Return the branch-computed value (`mkdtemp(join(parent, `${label}-`))`) through a Promise.
 * 协作入口 / Collaborators: `resolve`, `mkdir`, `mkdtemp`, `join`.
 */
async function directory(label: string) {
  const parent = resolve('artifacts', 'ha-witness-tests');
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, `${label}-`));
}

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `root, file, vm, plan, identity, witness, actions, promote, heartbeat`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `root, file, vm, plan, identity, witness, actions, promote, heartbeat`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `directory`, `join`, `randomUUID`, `'f'.repeat`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture() {
  const root = await directory('failback');
  const file = join(root, 'state.json');
  const sourceHostId = randomUUID(), sourceVmId = randomUUID(), targetHostId = randomUUID();
  const vm = { sourceHostId, sourceVmId, targetHostId, failureThreshold: 2,
    failbackBinding: 'f'.repeat(64) };
  const identity = { sourceHostId, sourceVmId };
  const plan = { ...identity, targetHostId, transferId: randomUUID(),
    remoteVmId: randomUUID(), snapshotId: randomUUID(), sha256: 'a'.repeat(64),
    snapshotAt: new Date(100_000).toISOString(), maxReplicaAgeMinutes: 60 };
  let time = 100_000, target: 'stopped' | 'running' = 'stopped';
  let sourceHealthy = false, retired = false;
  let traffic: string = sourceVmId;
  let denyRetire = false, denyRestore = false, loseRestoreResponse = false;
  let restoreCount = 0, retireCount = 0, activateCount = 0;
  const actions: HaWitnessActions = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    fence: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    confirmFence: async () => {},
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _vm; candidate。
     * 结果：返回分支计算值（`target`），以 Promise 交付。
     * Result: Return the branch-computed value (`target`) through a Promise.
     * 协作入口 / Collaborators: `assert.deepEqual`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(candidate, plan)`.
     */
    targetStatus: async (_vm, candidate) => {
      assert.deepEqual(candidate, plan); return target;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `target`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(retired, false)`.
     */
    activate: async () => { assert.equal(retired, false); target = 'running'; activateCount++; },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     */
    applicationReady: async () => true,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `traffic`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    switchTraffic: async () => { traffic = plan.remoteVmId; },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`traffic`），以 Promise 交付。
     * Result: Return the branch-computed value (`traffic`) through a Promise.
     */
    trafficTarget: async () => traffic,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _vm; candidate。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `retired`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('retirement not confirmed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `assert.deepEqual`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(candidate, plan)`.
     */
    retire: async (_vm, candidate) => {
      assert.deepEqual(candidate, plan);
      retireCount++;
      if (target !== 'stopped' || denyRetire) throw new Error('retirement not confirmed');
      retired = true;
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`sourceHealthy`），以 Promise 交付。
     * Result: Return the branch-computed value (`sourceHealthy`) through a Promise.
     */
    sourceApplicationReady: async () => sourceHealthy,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: candidateVm; candidate。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `traffic`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('restore rejected')`; `new Error('restore response lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(candidateVm.sourceVmId, sourceVmId)`; `assert.equal(candidate.remoteVmId, plan.remoteVmId)`.
     */
    restoreTraffic: async (candidateVm, candidate) => {
      assert.equal(candidateVm.sourceVmId, sourceVmId);
      assert.equal(candidate.remoteVmId, plan.remoteVmId);
      assert.equal(retired, true);
      restoreCount++;
      if (denyRestore) throw new Error('restore rejected');
      traffic = sourceVmId;
      if (loseRestoreResponse) throw new Error('restore response lost');
    },
  };
  await HaWitness.initialize(file, [vm]);
  const witness = new HaWitness(file, [vm], actions, () => time);
  await witness.init();
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `time`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `witness.heartbeat`, `witness.sample`, `assert.equal`, `witness.status`.
   * 检查边界 / Checked boundaries: `assert.equal((await witness.status(identity)).phase, 'promoted')`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  const promote = async () => {
    await witness.heartbeat({ ...identity, failureThreshold: 2, plan });
    time = 130_000;
    await witness.sample();
    assert.equal((await witness.status(identity)).phase, 'promoted');
  };
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`witness.heartbeat({ ...identity, failureThreshold: 2, plan: null })`）。
   * Result: Return the branch-computed value (`witness.heartbeat({ ...identity, failureThreshold: 2, plan: null })`).
   * 协作入口 / Collaborators: `witness.heartbeat`.
   */
  const heartbeat = () => witness.heartbeat({ ...identity, failureThreshold: 2, plan: null });
  return { root, file, vm, plan, identity, witness, actions, promote, heartbeat,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: 'stopped' | 'running'。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `target`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    target: (value: 'stopped' | 'running') => { target = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `sourceHealthy`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    healthy: (value: boolean) => { sourceHealthy = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `denyRetire`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    denyRetire: (value: boolean) => { denyRetire = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `denyRestore`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    denyRestore: (value: boolean) => { denyRestore = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `loseRestoreResponse`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    loseRestoreResponse: (value: boolean) => { loseRestoreResponse = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `traffic`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    traffic: (value: string) => { traffic = value; },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ restoreCount, retireCount, activateCount })`）。
     * Result: Return the branch-computed value (`({ restoreCount, retireCount, activateCount })`).
     */
    counts: () => ({ restoreCount, retireCount, activateCount }),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`reopened`），以 Promise 交付。
     * Result: Return the branch-computed value (`reopened`) through a Promise.
     * 协作入口 / Collaborators: `reopened.init`.
     */
    reopen: async () => {
      const reopened = new HaWitness(file, [vm], actions, () => time);
      await reopened.init(); return reopened;
    } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failback releases only a retired target, persists exact identity and waits for source health
 * 协作入口 / Collaborators: `fixture`, `f.promote`, `assert.rejects`, `f.witness.rejoin`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.witness.rejoin({ ...f.identity, dataReconciled: true }), /retirement/)`; `assert.rejects(f.witness.authorizeStart(f.identity), { code: 'HA_WITNESS_FENCED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failback releases only a retired target, persists exact identity and waits for source health', async () => {
  const f = await fixture();
  await f.promote();
  await assert.rejects(f.witness.rejoin({ ...f.identity, dataReconciled: true }), /retirement/);
  await assert.rejects(f.witness.authorizeStart(f.identity), { code: 'HA_WITNESS_FENCED' });
  f.target('stopped');
  const released = await f.witness.rejoin({ ...f.identity, dataReconciled: true });
  assert.deepEqual(released, { released: true, retiredRemoteVmId: f.plan.remoteVmId, failback: 'pending' });
  const saved = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(saved.version, 4);
  assert.deepEqual(saved.entries[f.vm.sourceVmId].failback.plan, f.plan);
  await f.witness.sample();
  assert.match((await f.witness.status(f.identity)).error || '', /存活心跳/);
  await f.heartbeat();
  await f.witness.sample();
  assert.match((await f.witness.status(f.identity)).error || '', /健康检查/);
  assert.equal(f.counts().restoreCount, 0);
  assert.equal((await f.witness.authorizeStart(f.identity)).allowed, true);
  await assert.rejects(f.witness.heartbeat({ ...f.identity, failureThreshold: 2,
    plan: { ...f.plan, transferId: randomUUID() } }), /回切尚未完成/);
  f.healthy(true); f.denyRetire(true);
  await f.witness.sample();
  assert.equal(f.counts().restoreCount, 0, 'a missing renewed retirement proof cannot restore routing');
  f.denyRetire(false); f.denyRestore(true);
  await f.witness.sample();
  assert.equal((await f.witness.status(f.identity)).failback?.phase, 'pending');
  assert.match((await f.witness.status(f.identity)).error || '', /restore rejected/);
  f.denyRestore(false);
  await f.witness.sample();
  assert.equal((await f.witness.status(f.identity)).failback?.phase, 'completed');
  assert.equal((await f.witness.status(f.identity)).error, null);
  assert.equal(f.counts().activateCount, 1, 'returning must not restart the retired target');
  const reopened = await f.reopen();
  assert.deepEqual(await reopened.rejoin({ ...f.identity, dataReconciled: true }),
    { ...released, failback: 'completed' });
  const before = f.counts();
  await reopened.sample();
  assert.deepEqual(f.counts(), before, 'completed routing must not be rewritten');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a restored route with a lost response resumes after restart without a second restore write
 * 协作入口 / Collaborators: `fixture`, `f.promote`, `f.target`, `f.witness.rejoin`.
 * 检查边界 / Checked boundaries: `assert.equal(f.counts().restoreCount, 1)`; `assert.equal((await f.witness.status(f.identity)).failback?.phase, 'pending')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a restored route with a lost response resumes after restart without a second restore write', async () => {
  const f = await fixture();
  await f.promote(); f.target('stopped');
  await f.witness.rejoin({ ...f.identity, dataReconciled: true });
  await f.heartbeat(); f.healthy(true); f.loseRestoreResponse(true);
  await f.witness.sample();
  assert.equal(f.counts().restoreCount, 1);
  assert.equal((await f.witness.status(f.identity)).failback?.phase, 'pending');
  const reopened = await f.reopen();
  await reopened.sample();
  assert.equal(f.counts().restoreCount, 1);
  assert.equal((await reopened.status(f.identity)).failback?.phase, 'completed');
  await assert.rejects(new HaWitness(f.file, [{ ...f.vm, failbackBinding: 'd'.repeat(64) }],
    f.actions).init(), { code: 'HA_WITNESS_STATE_MISMATCH' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: automatic failback cannot overwrite traffic redirected to an unknown third VM
 * 协作入口 / Collaborators: `fixture`, `f.promote`, `f.target`, `f.witness.rejoin`.
 * 检查边界 / Checked boundaries: `assert.equal(f.counts().restoreCount, 0)`; `assert.equal((await f.witness.status(f.identity)).failback?.phase, 'pending')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('automatic failback cannot overwrite traffic redirected to an unknown third VM', async () => {
  const f = await fixture();
  await f.promote(); f.target('stopped');
  await f.witness.rejoin({ ...f.identity, dataReconciled: true });
  await f.heartbeat(); f.healthy(true); f.traffic(randomUUID());
  await f.witness.sample();
  assert.equal(f.counts().restoreCount, 0);
  assert.equal((await f.witness.status(f.identity)).failback?.phase, 'pending');
  assert.match((await f.witness.status(f.identity)).error || '', /未知实例/);
  const reopened = await f.reopen();
  await reopened.sample();
  assert.equal(f.counts().restoreCount, 0, 'restart must retain the unknown-route refusal');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a failed durable rejoin write never grants source start or attempts traffic restoration
 * 协作入口 / Collaborators: `fixture`, `f.promote`, `f.target`, `rename`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.witness.rejoin({ ...f.identity, dataReconciled: true }))`; `assert.rejects(f.witness.authorizeStart(f.identity), { code: 'HA_WITNESS_STORAGE_UNAVAILABLE' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a failed durable rejoin write never grants source start or attempts traffic restoration', async () => {
  const f = await fixture();
  await f.promote(); f.target('stopped');
  await rename(f.file, join(f.root, 'before-failed-rejoin.json'));
  await mkdir(f.file);
  await assert.rejects(f.witness.rejoin({ ...f.identity, dataReconciled: true }));
  await assert.rejects(f.witness.authorizeStart(f.identity), { code: 'HA_WITNESS_STORAGE_UNAVAILABLE' });
  assert.equal(f.counts().restoreCount, 0);
});

/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: server: Server。
 * 结果：返回分支计算值（``https://127.0.0.1:${address.port}/``），以 Promise 交付。
 * Result: Return the branch-computed value (``https://127.0.0.1:${address.port}/``) through a Promise.
 * 失败 / Failure: `new Error('missing port')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `server.address`.
 */
async function listen(server: Server) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  return `https://127.0.0.1:${address.port}/`;
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: request: import('node:http').IncomingMessage。
 * 结果：返回分支计算值（`body ? JSON.parse(body) : null`），以 Promise 交付。
 * Result: Return the branch-computed value (`body ? JSON.parse(body) : null`) through a Promise.
 * 状态影响 / State effects: `body`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `chunk.toString`, `JSON.parse`.
 */
async function input(request: import('node:http').IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  return body ? JSON.parse(body) : null;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HTTPS failback authenticates exact source health and retire identity before restoring traffic
 * 状态影响 / State effects: `service`, `time`, `targetRunning`, `sourceReady`, `healthIdentity`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 失败 / Failure: `new Error('witness port missing')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `directory`, `generate`, `Date.now`, `randomBytes(32).toString`.
 * 检查边界 / Checked boundaries: `assert.equal((await client.status(identity)).phase, 'promoted')`; `assert.rejects(client.rejoin({ ...identity, dataReconciled: true }))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('HTTPS failback authenticates exact source health and retire identity before restoring traffic', async () => {
  const root = await directory('failback-https');
  const cert = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
    notBeforeDate: new Date(Date.now() - 60_000), notAfterDate: new Date(Date.now() + 3600_000),
  });
  const fingerprint = new X509Certificate(cert.cert).fingerprint256;
  const sourceToken = randomBytes(32).toString('hex'), targetToken = randomBytes(32).toString('hex');
  const appToken = randomBytes(32).toString('hex'), trafficToken = randomBytes(32).toString('hex');
  const sourceHostId = randomUUID(), sourceVmId = randomUUID(), targetHostId = randomUUID();
  const sourceSystemUuid = randomUUID(), remoteVmId = randomUUID();
  let activeVmId = sourceVmId, sourceReady = false, targetRunning = false, retired = false;
  let healthIdentity = sourceVmId, retirementIdentity = remoteVmId;
  let restoreRefused = true, restoreCount = 0;
  let time = Date.now();
  const plan = { sourceHostId, sourceVmId, targetHostId, remoteVmId,
    transferId: randomUUID(), snapshotId: randomUUID(), sha256: 'a'.repeat(64),
    snapshotAt: new Date(time).toISOString(), maxReplicaAgeMinutes: 60 };
  const adapter = createServer({ cert: cert.cert, key: cert.private }, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: req; res。
   * 结果：返回分支计算值（`void (async () => { const url = new URL(req.url!, 'https://localhost'); if (url.…`）。
   * Result: Return the branch-computed value (`void (async () => { const url = new URL(req.url!, 'https://localhost'); if (url.…`).
   * 验证场景 / Scenario: HTTPS failback authenticates exact source health and retire identity before restoring traffic
   * 协作入口 / Collaborators: `(async () => { const url = new URL(req.url!, 'https://localhost'); if (url.…`.
   */
  (req, res) => void (/**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: HTTPS failback authenticates exact source health and retire identity before restoring traffic
   * 状态影响 / State effects: `retired`, `targetRunning`, `activeVmId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `res.end`, `JSON.stringify`, `assert.equal`, `url.pathname.startsWith`.
   * 检查边界 / Checked boundaries: `assert.equal(req.headers.authorization, `Bearer ${targetToken}`)`; `assert.equal(req.headers.authorization, `Bearer ${targetToken}`)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  async () => {
    const url = new URL(req.url!, 'https://localhost');
    if (url.pathname === '/redfish/v1/Systems/1') {
      res.end(JSON.stringify({ UUID: sourceSystemUuid, PowerState: 'Off' })); return;
    }
    if (url.pathname === '/peer/status') {
      assert.equal(req.headers.authorization, `Bearer ${targetToken}`);
      res.end(JSON.stringify({ version: 1, id: targetHostId })); return;
    }
    if (url.pathname.startsWith('/peer/replica-')) {
      assert.equal(req.headers.authorization, `Bearer ${targetToken}`);
      assert.deepEqual(await input(req), { transferId: plan.transferId, remoteVmId,
        sourceVmId, snapshotId: plan.snapshotId, sha256: plan.sha256 });
      if (url.pathname === '/peer/replica-retire') {
        if (targetRunning) { res.writeHead(409); res.end('{}'); return; }
        retired = true; res.end(JSON.stringify({ id: retirementIdentity, retired: true })); return;
      }
      if (url.pathname === '/peer/replica-activate') {
        assert.equal(retired, false); targetRunning = true;
        res.end(JSON.stringify({ id: remoteVmId, status: 'running' })); return;
      }
      res.end(JSON.stringify({ ready: true, id: remoteVmId,
        status: targetRunning ? 'running' : 'stopped' })); return;
    }
    if (url.pathname === '/health') {
      assert.equal(req.headers.authorization, `Bearer ${appToken}`);
      const requestedVmId = url.searchParams.get('vmId');
      assert.ok(requestedVmId === sourceVmId || requestedVmId === remoteVmId);
      res.end(JSON.stringify({ vmId: requestedVmId === sourceVmId ? healthIdentity : remoteVmId,
        ready: requestedVmId === sourceVmId ? sourceReady : targetRunning })); return;
    }
    assert.equal(req.headers.authorization, `Bearer ${trafficToken}`);
    if (url.pathname === '/activate') {
      assert.deepEqual(await input(req), { sourceVmId, targetVmId: remoteVmId });
      activeVmId = remoteVmId;
    } else if (url.pathname === '/restore') {
      assert.deepEqual(await input(req), { sourceVmId, retiredVmId: remoteVmId });
      assert.equal(retired, true); assert.equal(sourceReady, true);
      restoreCount++;
      if (restoreRefused) { res.writeHead(409); res.end('{}'); return; }
      activeVmId = sourceVmId;
    } else {
      assert.equal(url.pathname, '/status');
      assert.equal(url.searchParams.get('sourceVmId'), sourceVmId);
    }
    res.end(JSON.stringify({ accepted: true, activeVmId }));
  })().catch((error) => { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }));
  let service: Awaited<ReturnType<typeof startHaWitnessServer>> | undefined;
  try {
    const baseUrl = await listen(adapter);
    const certFile = join(root, 'cert.pem'), keyFile = join(root, 'key.pem');
    await writeFile(certFile, cert.cert); await writeFile(keyFile, cert.private);
    const application = { url: `${baseUrl}health`, token: appToken, fingerprint };
    const config = { version: 1 as const, stateFile: join(root, 'state.json'), sourceToken,
      listen: { host: '127.0.0.1', port: 0, certFile, keyFile },
      vms: [{ sourceHostId, sourceVmId, targetHostId, failureThreshold: 2,
        redfish: { baseUrl, systemPath: '/redfish/v1/Systems/1', systemUuid: sourceSystemUuid,
          username: 'user', password: 'password', fingerprint },
        target: { baseUrl, token: targetToken, fingerprint }, application,
        traffic: { baseUrl, token: trafficToken, fingerprint }, failback: { application } }] };
    await HaWitness.initialize(config.stateFile, witnessVms(config));
    service = await startHaWitnessServer(config, () => time);
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('witness port missing');
    const client = new HaWitnessClient({ version: 1, token: sourceToken, fingerprint,
      url: `https://127.0.0.1:${address.port}/` });
    const identity = { sourceHostId, sourceVmId };
    await client.heartbeat({ ...identity, failureThreshold: 2, plan });
    time += 30_000; await service.witness.sample();
    assert.equal((await client.status(identity)).phase, 'promoted');
    await assert.rejects(client.rejoin({ ...identity, dataReconciled: true }));
    await assert.rejects(client.authorizeStart(identity));
    targetRunning = false;
    assert.equal((await client.rejoin({ ...identity, dataReconciled: true })).failback, 'pending');
    await client.authorizeStart(identity);
    await client.heartbeat({ ...identity, failureThreshold: 2, plan: null });
    sourceReady = true; healthIdentity = randomUUID();
    await service.witness.sample();
    assert.equal(restoreCount, 0, 'a healthy reply for another VM cannot restore traffic');
    healthIdentity = sourceVmId;
    retirementIdentity = randomUUID();
    await service.witness.sample();
    assert.equal(restoreCount, 0, 'a retirement reply for another replica cannot restore traffic');
    assert.equal((await client.status(identity)).failback?.phase, 'pending');
    retirementIdentity = remoteVmId;
    await service.witness.sample();
    assert.equal((await client.status(identity)).failback?.phase, 'pending');
    assert.equal(activeVmId, remoteVmId);
    restoreRefused = false; await service.witness.sample();
    assert.equal(activeVmId, sourceVmId);
    assert.equal((await client.status(identity)).failback?.phase, 'completed');
    const verified = await checkHaWitnessDeployment(config);
    assert.equal(verified.ok, true);
    assert.equal(verified.vms[0].failback?.phase, 'completed');
    await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true,
      retired, restoreCount, activeVmId, sourceVmId, remoteVmId }, null, 2));
  } finally {
    await service?.close();
    await new Promise<void>((done) => adapter.close(() => done()));
  }
});
