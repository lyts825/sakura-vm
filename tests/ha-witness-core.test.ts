/**
 * 模块职责：回归验证模块，围绕 `ha-witness-core` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-witness-core`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: witness persists fencing before target activation and denies a returning source; uncertain power state never starts the target and survives process restart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { HaWitness, type HaWitnessActions } from '../server/ha-witness-core.ts';

const sourceHostId = randomUUID(), sourceVmId = randomUUID(), targetHostId = randomUUID();
const plan = { sourceHostId, sourceVmId, targetHostId,
  transferId: randomUUID(), remoteVmId: randomUUID(), snapshotId: randomUUID(),
  sha256: 'a'.repeat(64), snapshotAt: new Date(100_000).toISOString(),
  maxReplicaAgeMinutes: 10 };
const vm = { sourceHostId, sourceVmId, targetHostId, failureThreshold: 2 };

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `root, file, witness, calls, clock, target, healthy, failFence, failRetire`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `root, file, witness, calls, clock, target, healthy, failFence, failRetire`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `HaWitness.initialize`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sakura-ha-witness-'));
  let time = 100_000, poweredOff = false, target: 'stopped' | 'starting' | 'running' = 'stopped';
  let healthy = false, traffic = '', failFence = false, failRetire = false;
  const calls: string[] = [];
  const actions: HaWitnessActions = {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `poweredOff`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('BMC did not confirm Off')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `calls.push`.
     */
    fence: async () => {
      calls.push('fence');
      if (failFence) throw new Error('BMC did not confirm Off');
      poweredOff = true;
    },
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('source power is no longer Off')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `calls.push`.
     */
    confirmFence: async () => {
      calls.push('confirm-fence');
      if (!poweredOff) throw new Error('source power is no longer Off');
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`target`），以 Promise 交付。
     * Result: Return the branch-computed value (`target`) through a Promise.
     * 协作入口 / Collaborators: `calls.push`.
     */
    targetStatus: async () => { calls.push('target-status'); return target; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `target`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`, `calls.push`.
     * 检查边界 / Checked boundaries: `assert.equal(poweredOff, true)`.
     */
    activate: async () => {
      assert.equal(poweredOff, true);
      calls.push('activate'); target = 'starting';
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`healthy`），以 Promise 交付。
     * Result: Return the branch-computed value (`healthy`) through a Promise.
     * 协作入口 / Collaborators: `calls.push`.
     */
    applicationReady: async () => { calls.push('app-health'); return healthy; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `traffic`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `calls.push`.
     */
    switchTraffic: async () => { calls.push('traffic-switch'); traffic = plan.remoteVmId; },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`traffic`），以 Promise 交付。
     * Result: Return the branch-computed value (`traffic`) through a Promise.
     * 协作入口 / Collaborators: `calls.push`.
     */
    trafficTarget: async () => { calls.push('traffic-check'); return traffic; },
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('target is still running')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `calls.push`.
     */
    retire: async () => {
      calls.push('retire');
      if (failRetire || target !== 'stopped') throw new Error('target is still running');
    },
  };
  const file = join(root, 'witness.json');
  await HaWitness.initialize(file, [vm]);
  const witness = new HaWitness(file, [vm], actions, () => time);
  await witness.init();
  return { root, file, witness, calls,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `time`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    clock: (value: number) => { time = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: 'stopped' | 'starting' | 'running'。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `target`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    target: (value: 'stopped' | 'starting' | 'running') => { target = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `healthy`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    healthy: (value: boolean) => { healthy = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `failFence`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    failFence: (value: boolean) => { failFence = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `failRetire`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    failRetire: (value: boolean) => { failRetire = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `poweredOff`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    poweredOff: (value: boolean) => { poweredOff = value; },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('unsafe witness cleanup')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `realpath`, `basename(path).startsWith`, `basename`, `resolve`.
     */
    cleanup: async () => {
      const path = await realpath(root);
      if (!basename(path).startsWith('sakura-ha-witness-') ||
          resolve(path) === resolve(tmpdir())) throw new Error('unsafe witness cleanup');
      await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: witness persists fencing before target activation and denies a returning source
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `f.witness.authorizeStart`, `f.witness.heartbeat`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.witness.authorizeStart({ sourceHostId, sourceVmId })).allowed, true)`; `assert.deepEqual(f.calls, [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('witness persists fencing before target activation and denies a returning source', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.witness.authorizeStart({ sourceHostId, sourceVmId })).allowed, true);
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.clock(129_999);
    await f.witness.sample();
    assert.deepEqual(f.calls, []);
    f.clock(130_000);
    await f.witness.sample();
    assert.deepEqual(f.calls.slice(0, 4), ['fence', 'confirm-fence', 'target-status', 'activate']);
    const reopened = new HaWitness(f.file, [vm], {
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness persists fencing before target activation and denies a returning source
       * 失败 / Failure: `new Error('fence must not repeat after confirmation')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      fence: async () => { throw new Error('fence must not repeat after confirmation'); },
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness persists fencing before target activation and denies a returning source
       */
      confirmFence: async () => {},
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'running'`），以 Promise 交付。
       * Result: Return the branch-computed value (`'running'`) through a Promise.
       * 验证场景 / Scenario: witness persists fencing before target activation and denies a returning source
       */
      targetStatus: async () => 'running', /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness persists fencing before target activation and denies a returning source
       */
      activate: async () => {},
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回布尔判定，供用例选择路径或核对受控条件。
       * Result: Return a boolean decision for path selection or controlled-condition assertions.
       * 验证场景 / Scenario: witness persists fencing before target activation and denies a returning source
       */
      applicationReady: async () => true, /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness persists fencing before target activation and denies a returning source
       */
      switchTraffic: async () => {},
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`plan.remoteVmId`），以 Promise 交付。
       * Result: Return the branch-computed value (`plan.remoteVmId`) through a Promise.
       * 验证场景 / Scenario: witness persists fencing before target activation and denies a returning source
       */
      trafficTarget: async () => plan.remoteVmId, /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness persists fencing before target activation and denies a returning source
       */
      retire: async () => {},
    }, () => 131_000);
    await reopened.init();
    await assert.rejects(reopened.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_FENCED' });
    await assert.rejects(reopened.heartbeat({ sourceHostId, sourceVmId,
      failureThreshold: 2, plan }),
      { code: 'HA_WITNESS_FENCED' });
    await reopened.sample();
    assert.equal((await reopened.status({ sourceHostId, sourceVmId })).phase, 'promoted');
  } finally { await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: uncertain power state never starts the target and survives process restart
 * 协作入口 / Collaborators: `fixture`, `f.witness.heartbeat`, `f.failFence`, `f.clock`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(f.calls, ['fence'])`; `assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'fencing')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('uncertain power state never starts the target and survives process restart', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.failFence(true);
    f.clock(130_000);
    await f.witness.sample();
    assert.deepEqual(f.calls, ['fence']);
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'fencing');
    await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_FENCED' });
    f.failFence(false);
    await f.witness.sample();
    assert.deepEqual(f.calls.slice(1, 5), ['fence', 'confirm-fence', 'target-status', 'activate']);
  } finally { await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stale replica is disarmed; promotion waits for application health and verified traffic
 * 协作入口 / Collaborators: `fixture`, `f.witness.heartbeat`, `f.clock`, `f.witness.sample`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'fenced')`; `assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'promoted')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('stale replica is disarmed; promotion waits for application health and verified traffic', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.clock(130_000);
    await f.witness.sample();
    f.target('running');
    await f.witness.sample();
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'fenced');
    f.healthy(true);
    await f.witness.sample();
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'promoted');
    f.failRetire(true);
    await assert.rejects(f.witness.rejoin({ sourceHostId, sourceVmId }), /invalid_type|Invalid input/);
    await assert.rejects(f.witness.rejoin({ sourceHostId, sourceVmId,
      dataReconciled: true }), /running/);
    await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_FENCED' });
    f.failRetire(false);
    f.target('stopped');
    await f.witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true });
    assert.deepEqual(await f.witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true }),
      { released: true, retiredRemoteVmId: plan.remoteVmId }, 'lost successful responses are idempotent');
    assert.equal((await f.witness.authorizeStart({ sourceHostId, sourceVmId })).allowed, true);
  } finally { await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: expired replica cannot arm a host-loss failover
 * 协作入口 / Collaborators: `fixture`, `f.clock`, `assert.equal`, `f.witness.heartbeat`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan })).armed, false)`; `assert.deepEqual(f.calls, [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('expired replica cannot arm a host-loss failover', async () => {
  const f = await fixture();
  try {
    f.clock(100_000 + 11 * 60_000);
    assert.equal((await f.witness.heartbeat({ sourceHostId, sourceVmId,
      failureThreshold: 2, plan })).armed,
      false);
    await f.witness.sample();
    assert.deepEqual(f.calls, []);
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'source');
  } finally { await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: liveness-only heartbeats retain a verified plan until explicit disarm
 * 协作入口 / Collaborators: `fixture`, `f.witness.heartbeat`, `f.clock`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2 })).armed, true)`; `assert.deepEqual(f.calls, [], 'slow validation does not appear as source loss')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('liveness-only heartbeats retain a verified plan until explicit disarm', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.clock(120_000);
    assert.equal((await f.witness.heartbeat({ sourceHostId, sourceVmId,
      failureThreshold: 2 })).armed, true);
    f.clock(130_000);
    await f.witness.sample();
    assert.deepEqual(f.calls, [], 'slow validation does not appear as source loss');
    assert.equal((await f.witness.heartbeat({ sourceHostId, sourceVmId,
      failureThreshold: 2, plan: null })).armed, false);
    f.clock(160_000);
    await f.witness.sample();
    assert.deepEqual(f.calls, [], 'explicit disarm removes the failover candidate');
  } finally { await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a historical fence cannot activate or switch traffic after the source powers on again
 * 协作入口 / Collaborators: `fixture`, `f.witness.heartbeat`, `f.clock`, `f.witness.sample`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(f.calls.slice(before), ['confirm-fence'])`; `assert.equal(status.phase, 'fenced')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a historical fence cannot activate or switch traffic after the source powers on again', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.clock(130_000);
    await f.witness.sample();
    f.target('stopped');
    f.poweredOff(false);
    const before = f.calls.length;
    await f.witness.sample();
    assert.deepEqual(f.calls.slice(before), ['confirm-fence']);
    const status = await f.witness.status({ sourceHostId, sourceVmId });
    assert.equal(status.phase, 'fenced');
    assert.match(status.error || '', /no longer Off/);
    await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_FENCED' });
    f.poweredOff(true);
    f.target('running');
    f.healthy(true);
    await f.witness.sample();
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'promoted');
  } finally { await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a promoted target restarts the same writable replica and repairs traffic only when needed
 * 协作入口 / Collaborators: `fixture`, `f.witness.heartbeat`, `f.clock`, `f.witness.sample`.
 * 检查边界 / Checked boundaries: `assert.equal(f.calls.slice(before).includes('activate'), false)`; `assert.equal(f.calls.slice(before).includes('traffic-switch'), false, 'healthy promoted samples must not rewrite production routin…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a promoted target restarts the same writable replica and repairs traffic only when needed', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.clock(130_000);
    await f.witness.sample();
    f.target('running'); f.healthy(true);
    await f.witness.sample();
    const promoted = await f.witness.status({ sourceHostId, sourceVmId });
    const before = f.calls.length;
    await f.witness.sample();
    assert.equal(f.calls.slice(before).includes('activate'), false);
    assert.equal(f.calls.slice(before).includes('traffic-switch'), false,
      'healthy promoted samples must not rewrite production routing');
    f.target('stopped');
    f.clock(140_000);
    await f.witness.sample();
    assert.equal(f.calls.filter((call) => call === 'activate').length, 2);
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'promoted');
    f.target('running');
    await f.witness.sample();
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).promotedAt, promoted.promotedAt);
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).error, null);
    f.poweredOff(false); f.target('stopped');
    const activations = f.calls.filter((call) => call === 'activate').length;
    await f.witness.sample();
    assert.equal(f.calls.filter((call) => call === 'activate').length, activations);
    await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_FENCED' });
  } finally { await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a failed authority write freezes source start and prevents external takeover work
 * 协作入口 / Collaborators: `fixture`, `f.witness.heartbeat`, `rm`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.witness.sample())`; `assert.deepEqual(f.calls, [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a failed authority write freezes source start and prevents external takeover work', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    await rm(f.file);
    await mkdir(f.file);
    f.clock(130_000);
    await assert.rejects(f.witness.sample());
    assert.deepEqual(f.calls, []);
    await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_STORAGE_UNAVAILABLE' });
    await assert.rejects(f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2 }),
      { code: 'HA_WITNESS_STORAGE_UNAVAILABLE' });
    assert.match((await f.witness.status({ sourceHostId, sourceVmId })).error || '', /持久存储写入失败/);
  } finally { await f.cleanup(); }
});

for (const failedPhase of ['fencing', 'fenced'] as const)
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `f.witness.heartbeat`, `f.failFence`, `f.clock`.
   * 检查边界 / Checked boundaries: `assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, failedPhase)`; `assert.rejects(f.witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true }), /still running/)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`an interrupted ${failedPhase} takeover can release only an explicitly reconciled, retired target`, async () => {
    const f = await fixture();
    try {
      await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
      f.failFence(failedPhase === 'fencing');
      f.clock(130_000);
      await f.witness.sample();
      assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, failedPhase);
      f.target('running');
      await assert.rejects(f.witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true }),
        /still running/);
      await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
        { code: 'HA_WITNESS_FENCED' });
      f.target('stopped');
      const result = await f.witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true });
      assert.deepEqual(result, { released: true, retiredRemoteVmId: plan.remoteVmId });
      const saved = JSON.parse(await readFile(f.file, 'utf8'));
      assert.equal(saved.entries[sourceVmId].retiredRemoteVmId, plan.remoteVmId);
      await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan: null });
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
        confirmFence: async () => {}, /**
         * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
         * English: Read or resolve observable fixture state for business calls or subsequent assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`'stopped'`），以 Promise 交付。
         * Result: Return the branch-computed value (`'stopped'`) through a Promise.
         */
        targetStatus: async () => 'stopped',
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         */
        activate: async () => {}, /**
         * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
         * English: Read or resolve observable fixture state for business calls or subsequent assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回布尔判定，供用例选择路径或核对受控条件。
         * Result: Return a boolean decision for path selection or controlled-condition assertions.
         */
        applicationReady: async () => false,
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         */
        switchTraffic: async () => {}, /**
         * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
         * English: Read or resolve observable fixture state for business calls or subsequent assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`''`），以 Promise 交付。
         * Result: Return the branch-computed value (`''`) through a Promise.
         */
        trafficTarget: async () => '',
        /**
         * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
         * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 失败 / Failure: `new Error('successful durable retirement must not repeat')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         */
        retire: async () => { throw new Error('successful durable retirement must not repeat'); },
      };
      const reopened = new HaWitness(f.file, [vm], actions, () => 131_000);
      await reopened.init();
      assert.deepEqual(await reopened.rejoin({ sourceHostId, sourceVmId, dataReconciled: true }), result);
      assert.equal((await reopened.authorizeStart({ sourceHostId, sourceVmId })).allowed, true);
    } finally { await f.cleanup(); }
  });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
 * 状态影响 / State effects: `time`, `sample`, `draining`, `rejoining`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 失败 / Failure: `new Error('unsafe witness cleanup')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.equal(drainFinished, false, 'shutdown must wait for in-flight fencing')`; `assert.equal(drainFinished, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('slow fencing and retirement for one host do not block another host heartbeat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-ha-witness-multi-'));
  const file = join(root, 'witness.json');
  const secondVm = { sourceHostId, sourceVmId: randomUUID(),
    targetHostId: randomUUID(), failureThreshold: 2 };
  const secondPlan = { ...plan, sourceVmId: secondVm.sourceVmId,
    targetHostId: secondVm.targetHostId, transferId: randomUUID(),
    remoteVmId: randomUUID() };
  let time = 100_000;
  let /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
   */
  releaseFence = () => {}, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
   */
  enteredFence = () => {};
  let /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
   */
  releaseRetire = () => {}, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
   */
  enteredRetire = () => {};
  const fenceGate = new Promise<void>((resolve) => { releaseFence = resolve; });
  const fenceStarted = new Promise<void>((resolve) => { enteredFence = resolve; });
  const retireGate = new Promise<void>((resolve) => { releaseRetire = resolve; });
  const retireStarted = new Promise<void>((resolve) => { enteredRetire = resolve; });
  const actions: HaWitnessActions = {
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: source。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
     * 失败 / Failure: `new Error('healthy host must not be fenced')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `enteredFence`.
     */
    fence: async (source) => {
      if (source.sourceVmId === sourceVmId) { enteredFence(); await fenceGate; }
      else throw new Error('healthy host must not be fenced');
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
     */
    confirmFence: async () => {},
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`），以 Promise 交付。
     * Result: Return the branch-computed value (`'running'`) through a Promise.
     * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
     */
    targetStatus: async () => 'running', /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
     */
    activate: async () => {},
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
     */
    applicationReady: async () => true, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
     */
    switchTraffic: async () => {},
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _source; candidate。
     * 结果：返回分支计算值（`candidate.remoteVmId`），以 Promise 交付。
     * Result: Return the branch-computed value (`candidate.remoteVmId`) through a Promise.
     * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
     */
    trafficTarget: async (_source, candidate) => candidate.remoteVmId,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
     * 协作入口 / Collaborators: `enteredRetire`.
     */
    retire: async () => { enteredRetire(); await retireGate; },
  };
  await HaWitness.initialize(file, [vm, secondVm]);
  const witness = new HaWitness(file, [vm, secondVm], actions, () => time);
  let sample: ReturnType<HaWitness['sample']> | undefined;
  let rejoining: ReturnType<HaWitness['rejoin']> | undefined;
  let draining: ReturnType<HaWitness['drain']> | undefined;
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: slow fencing and retirement for one host do not block another host heartbeat
   * 协作入口 / Collaborators: `Promise.race`, `witness.heartbeat`, `assert.equal`, `clearTimeout`.
   * 检查边界 / Checked boundaries: `assert.equal(response.armed, true)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  const keepSecondAlive = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        witness.heartbeat({ sourceHostId, sourceVmId: secondVm.sourceVmId,
          failureThreshold: 2 }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('healthy host heartbeat stalled')), 2000);
        }),
      ]);
      assert.equal(response.armed, true);
    } finally { clearTimeout(timeout); }
  };
  try {
    await witness.init();
    await witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    time = 115_000;
    await witness.heartbeat({ sourceHostId, sourceVmId: secondVm.sourceVmId,
      failureThreshold: 2, plan: secondPlan });
    time = 130_000;
    sample = witness.sample();
    await fenceStarted;
    let drainFinished = false;
    draining = witness.drain().then(() => { drainFinished = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drainFinished, false, 'shutdown must wait for in-flight fencing');
    time = 140_000;
    await keepSecondAlive();
    releaseFence();
    await sample;
    await draining;
    assert.equal(drainFinished, true);
    assert.equal((await witness.status({ sourceHostId, sourceVmId })).phase, 'promoted');
    rejoining = witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true });
    await retireStarted;
    time = 145_000;
    await keepSecondAlive();
    releaseRetire();
    await rejoining;
    assert.equal((await witness.status({ sourceHostId,
      sourceVmId: secondVm.sourceVmId })).phase, 'source');
  } finally {
    releaseFence(); releaseRetire();
    await Promise.allSettled([sample, rejoining, draining].filter(Boolean));
    const path = await realpath(root);
    if (!basename(path).startsWith('sakura-ha-witness-multi-') ||
        resolve(path) === resolve(tmpdir())) throw new Error('unsafe witness cleanup');
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: witness refuses a missing state file and refuses to overwrite an existing state
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `HaWitness.initialize`, `rm`.
 * 检查边界 / Checked boundaries: `assert.rejects(HaWitness.initialize(f.file, [vm]), /已存在/)`; `assert.rejects(empty.init(), { code: 'HA_WITNESS_STATE_MISSING' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('witness refuses a missing state file and refuses to overwrite an existing state', async () => {
  const f = await fixture();
  try {
    await assert.rejects(HaWitness.initialize(f.file, [vm]), /已存在/);
    await rm(f.file);
    const empty = new HaWitness(f.file, [vm], {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness refuses a missing state file and refuses to overwrite an existing state
       */
      fence: async () => {}, /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness refuses a missing state file and refuses to overwrite an existing state
       */
      confirmFence: async () => {}, /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'stopped'`），以 Promise 交付。
       * Result: Return the branch-computed value (`'stopped'`) through a Promise.
       * 验证场景 / Scenario: witness refuses a missing state file and refuses to overwrite an existing state
       */
      targetStatus: async () => 'stopped',
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness refuses a missing state file and refuses to overwrite an existing state
       */
      activate: async () => {}, /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回布尔判定，供用例选择路径或核对受控条件。
       * Result: Return a boolean decision for path selection or controlled-condition assertions.
       * 验证场景 / Scenario: witness refuses a missing state file and refuses to overwrite an existing state
       */
      applicationReady: async () => false,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness refuses a missing state file and refuses to overwrite an existing state
       */
      switchTraffic: async () => {}, /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`''`），以 Promise 交付。
       * Result: Return the branch-computed value (`''`) through a Promise.
       * 验证场景 / Scenario: witness refuses a missing state file and refuses to overwrite an existing state
       */
      trafficTarget: async () => '',
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness refuses a missing state file and refuses to overwrite an existing state
       */
      retire: async () => {},
    });
    await assert.rejects(empty.init(), { code: 'HA_WITNESS_STATE_MISSING' });
  } finally { await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: witness refuses missing entries, changed identities and legacy state
 * 协作入口 / Collaborators: `fixture`, `JSON.parse`, `readFile`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.rejects(reopen(), { code: 'HA_WITNESS_STATE_MISMATCH' })`; `assert.rejects(reopen({ ...vm, failureThreshold: 3 }), { code: 'HA_WITNESS_STATE_MISMATCH' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('witness refuses missing entries, changed identities and legacy state', async () => {
  const f = await fixture();
  try {
    const original = JSON.parse(await readFile(f.file, 'utf8'));
    const actions: HaWitnessActions = {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness refuses missing entries, changed identities and legacy state
       */
      fence: async () => {}, /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness refuses missing entries, changed identities and legacy state
       */
      confirmFence: async () => {}, /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'stopped'`），以 Promise 交付。
       * Result: Return the branch-computed value (`'stopped'`) through a Promise.
       * 验证场景 / Scenario: witness refuses missing entries, changed identities and legacy state
       */
      targetStatus: async () => 'stopped',
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness refuses missing entries, changed identities and legacy state
       */
      activate: async () => {}, /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回布尔判定，供用例选择路径或核对受控条件。
       * Result: Return a boolean decision for path selection or controlled-condition assertions.
       * 验证场景 / Scenario: witness refuses missing entries, changed identities and legacy state
       */
      applicationReady: async () => false,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness refuses missing entries, changed identities and legacy state
       */
      switchTraffic: async () => {}, /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`''`），以 Promise 交付。
       * Result: Return the branch-computed value (`''`) through a Promise.
       * 验证场景 / Scenario: witness refuses missing entries, changed identities and legacy state
       */
      trafficTarget: async () => '',
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: witness refuses missing entries, changed identities and legacy state
       */
      retire: async () => {},
    };
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: config = vm。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: witness refuses missing entries, changed identities and legacy state
     * 协作入口 / Collaborators: `witness.init`.
     */
    const reopen = async (config = vm) => {
      const witness = new HaWitness(f.file, [config], actions);
      await witness.init();
    };
    for (const invalid of [
      { ...original, entries: {} },
      { ...original, bindings: {} },
      { ...original, bindings: {
        [sourceVmId]: { ...original.bindings[sourceVmId], targetHostId: randomUUID() },
      } },
      { version: 1, entries: original.entries },
      { ...original, entries: { [sourceVmId]: { ...original.entries[sourceVmId],
        phase: 'fenced', plan: null } } },
      { ...original, entries: { [sourceVmId]: { ...original.entries[sourceVmId],
        plan: { ...plan, sourceVmId: randomUUID() } } } },
      { ...original, entries: { [sourceVmId]: { ...original.entries[sourceVmId],
        plan: { ...plan, sourceHostId: randomUUID() } } } },
      { ...original, entries: { [sourceVmId]: { ...original.entries[sourceVmId],
        plan: { ...plan, targetHostId: randomUUID() } } } },
    ]) {
      await writeFile(f.file, JSON.stringify(invalid));
      await assert.rejects(reopen(), { code: 'HA_WITNESS_STATE_MISMATCH' });
    }
    await writeFile(f.file, JSON.stringify(original));
    await assert.rejects(reopen({ ...vm, failureThreshold: 3 }),
      { code: 'HA_WITNESS_STATE_MISMATCH' });
    await assert.rejects(reopen({ ...vm, sourceHostId: randomUUID() }),
      { code: 'HA_WITNESS_STATE_MISMATCH' });
    await reopen();
  } finally { await f.cleanup(); }
});
