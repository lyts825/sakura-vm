/**
 * 模块职责：回归验证模块，围绕 `power-policy` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `power-policy`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: power policy fails closed for starts with stale or unknown samples, and never stops without a known low battery; scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'sakura-power-test-'));
process.env.SAKURA_DATA_DIR = root;
const { powerPolicySchema, powerPolicy, savePowerPolicy, powerDecision, hostPower } =
  await import('../server/power-policy.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { FeatureScheduler } = await import('../server/feature-scheduler.ts');
const { saveMaintenancePolicy } = await import('../server/automation-policy.ts');

// Deliberately near a minute boundary: metadata I/O must not change a test's schedule minute.
const fixedPowerTime = Date.UTC(2026, 9, 5, 4, 34, 59, 990);

// The production scheduler intentionally unrefs its timer. A test awaiting its
// first query owns a bounded wait, without making idle production work keep Node alive.
/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: waiting: Promise<void>。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Promise.race`, `clearTimeout`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
async function waitForPowerQuery(waiting: Promise<void>) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([waiting, new Promise<void>((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Power query did not start')), 5000);
    })]);
  } finally { clearTimeout(deadline); }
}
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-power-test-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: power policy fails closed for starts with stale or unknown samples, and never stops without a known low battery
 * 协作入口 / Collaborators: `new Date(now).toISOString`, `powerPolicySchema.parse`, `assert.equal`, `powerDecision`.
 * 检查边界 / Checked boundaries: `assert.equal(powerDecision(policy, sample, now).allowStart, true)`; `assert.equal(powerDecision(policy, { ...sample, batteryPercent: 20 }, now).allowStart, false)`.
 */
test('power policy fails closed for starts with stale or unknown samples, and never stops without a known low battery', () => {
  const now = fixedPowerTime,
    sample = {
      checkedAt: new Date(now).toISOString(),
      onAC: false,
      batteryPresent: true,
      batteryPercent: 50,
    };
  const policy = powerPolicySchema.parse({
    enabled: true,
    allowBatteryStarts: true,
    minimumBatteryPercent: 30,
    stopBelowPercent: 10,
  });
  assert.equal(powerDecision(policy, sample, now).allowStart, true);
  assert.equal(powerDecision(policy, { ...sample, batteryPercent: 20 }, now).allowStart, false);
  assert.equal(powerDecision(policy, { ...sample, batteryPercent: 10 }, now).stop, true);
  assert.equal(powerDecision(policy, { ...sample, onAC: true, batteryPercent: 5 }, now).stop, false);
  for (const patch of [
    { onAC: null },
    { batteryPresent: null },
    { batteryPercent: null },
    { checkedAt: new Date(now - 90001).toISOString() },
    { checkedAt: new Date(now + 1).toISOString() },
  ]) {
    const result = powerDecision(policy, { ...sample, ...patch }, now);
    assert.equal(result.allowStart, false);
    assert.equal(result.stop, false);
  }
  assert.equal(powerDecision(powerPolicySchema.parse({}), { ...sample, batteryPercent: 0 }, now).stop, false);
  assert.equal(
    powerPolicySchema.safeParse({ minimumBatteryPercent: 10, stopBelowPercent: 10 }).success,
    false,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance
 * 状态影响 / State effects: `sample.onAC`, `sample`, `sample.batteryPercent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `t.mock.timers.enable`, `randomUUID`, `new Date().toISOString`, `suite.enableBackground`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await powerPolicy(id), policy)`; `assert.equal(starts, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: fixedPowerTime });
  const id = randomUUID(),
    vm = { id, cpus: 1, memoryMiB: 512 };
  let status = 'stopped',
    starts = 0,
    stops = 0,
    samples = 0;
  let sample = {
    checkedAt: new Date().toISOString(),
    onAC: false as boolean | null,
    batteryPresent: true,
    batteryPercent: 50 as number | null,
  };
  const machines: any = {
    records: new Map([[id, vm]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     * 验证场景 / Scenario: scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance
     */
    get: () => vm,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`status`）。
     * Result: Return the branch-computed value (`status`).
     * 验证场景 / Scenario: scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance
     */
    state: () => status,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    start: async () => {
      starts++;
      status = 'running';
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _id: string; force: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(force, false)`.
     */
    stop: async (_id: string, force: boolean) => {
      assert.equal(force, false);
      stops++;
      status = 'stopped';
    },
  };
  const workspaces: any = {
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'default'`）。
     * Result: Return the branch-computed value (`'default'`).
     * 验证场景 / Scenario: scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance
     */
    current: () => 'default', /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`id`）。
     * Result: Return the branch-computed value (`id`).
     * 验证场景 / Scenario: scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance
     */
    key: () => id },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ sampledAt: new Date().toISOString(), cpuPercent: 50, memoryTotal: 100, memory…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ sampledAt: new Date().toISOString(), cpuPercent: 50, memoryTotal: 100, memory…`) through a Promise.
     * 验证场景 / Scenario: scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance
     * 协作入口 / Collaborators: `new Date().toISOString`.
     */
    metrics: async () => ({
      sampledAt: new Date().toISOString(),
      cpuPercent: 50,
      memoryTotal: 100,
      memoryUsed: 50,
      diskTotal: 100,
      diskUsed: 50,
    }),
  };
  const suite = new FeatureSuite(machines, workspaces, {
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`sample`），以 Promise 交付。
     * Result: Return the branch-computed value (`sample`) through a Promise.
     * 验证场景 / Scenario: scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance
     */
    power: async () => {
      samples++;
      return sample;
    },
  });
  suite.enableBackground();
  const now = new Date(),
    startAt = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  await suite.update(id, { schedule: { enabled: true, startAt } });
  const policy = await savePowerPolicy(id, {
    enabled: true,
    minimumBatteryPercent: 30,
    stopBelowPercent: 10,
  });
  assert.deepEqual(await powerPolicy(id), policy);
  try {
    await suite.tick();
    assert.equal(starts, 0);
    sample.onAC = true;
    await suite.tick();
    assert.equal(starts, 1);
    sample = { ...sample, onAC: false, batteryPercent: 5 };
    await saveMaintenancePolicy(id, {
      enabled: true,
      windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00', timeZone: 'UTC' }],
    });
    await suite.tick();
    assert.equal(stops, 0);
    await saveMaintenancePolicy(id, { enabled: false, windows: [] });
    sample.batteryPercent = null;
    await suite.tick();
    assert.equal(stops, 0);
    sample.batteryPercent = 5;
    await suite.tick();
    assert.equal(stops, 1);
    await suite.tick();
    assert.equal(starts, 1);
    assert.equal(samples, 5);
  } finally {
    await suite.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: host power reads the real Windows source without changing its power plan
 * 协作入口 / Collaborators: `hostPower`, `assert.equal`, `assert.ok`, `[true, false, null].includes`.
 * 检查边界 / Checked boundaries: `assert.equal(sample.error, undefined)`; `assert.ok([true, false, null].includes(sample.onAC))`.
 */
test(
  'host power reads the real Windows source without changing its power plan',
  { skip: process.platform !== 'win32' },
  async () => {
    const sample = await hostPower();
    assert.equal(sample.error, undefined);
    assert.ok([true, false, null].includes(sample.onAC));
    if (sample.batteryPercent !== null) assert.ok(sample.batteryPercent >= 0 && sample.batteryPercent <= 100);
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closing the scheduler during a power query cannot start or stop an instance afterwards
 * 协作入口 / Collaborators: `t.mock.timers.enable`, `randomUUID`, `String(now.getHours()).padStart`, `String`.
 * 检查边界 / Checked boundaries: `assert.equal(calls, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('closing the scheduler during a power query cannot start or stop an instance afterwards', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: fixedPowerTime });
  const id = randomUUID();
  let complete!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: sample: any。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (sample: any) => void,
    entered!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void,
    calls = 0;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const machines: any = {
    records: new Map([[id, { id }]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id })`）。
     * Result: Return the branch-computed value (`({ id })`).
     * 验证场景 / Scenario: closing the scheduler during a power query cannot start or stop an instance afterwards
     */
    get: () => ({ id }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'stopped'`）。
     * Result: Return the branch-computed value (`'stopped'`).
     * 验证场景 / Scenario: closing the scheduler during a power query cannot start or stop an instance afterwards
     */
    state: () => 'stopped',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: closing the scheduler during a power query cannot start or stop an instance afterwards
     */
    start: async () => {
      calls++;
    },
  };
  const workspaces: any = { projects: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'default'`）。
   * Result: Return the branch-computed value (`'default'`).
   * 验证场景 / Scenario: closing the scheduler during a power query cannot start or stop an instance afterwards
   */
  current: () => 'default', /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`id`）。
   * Result: Return the branch-computed value (`id`).
   * 验证场景 / Scenario: closing the scheduler during a power query cannot start or stop an instance afterwards
   */
  key: () => id } };
  const suite = new FeatureSuite(machines, workspaces, {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`new Promise((resolve) => { complete = resolve; entered(); })`）。
     * Result: Return the branch-computed value (`new Promise((resolve) => { complete = resolve; entered(); })`).
     * 验证场景 / Scenario: closing the scheduler during a power query cannot start or stop an instance afterwards
     */
    power: () =>
      new Promise((resolve) => {
        complete = resolve;
        entered();
      }),
  });
  const now = new Date(),
    clock = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  await savePowerPolicy(id, { enabled: true });
  await suite.update(id, { schedule: { enabled: true, startAt: clock } });
  const running = suite.tick();
  await waiting;
  await suite.close();
  complete({ checkedAt: new Date().toISOString(), onAC: true, batteryPresent: true, batteryPercent: 100 });
  await running;
  assert.equal(calls, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disabling and re-enabling the scheduler cancels its power query and uses a new signal
 * 状态影响 / State effects: `aborted`, `scheduler`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `savePowerPolicy`, `waitForPowerQuery`, `scheduler.close`.
 * 检查边界 / Checked boundaries: `assert.equal(aborted, true)`; `assert.equal(aborted, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('disabling and re-enabling the scheduler cancels its power query and uses a new signal', async () => {
  const id = randomUUID();
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void,
    aborted = false;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const machines: any = { records: new Map([[id, { id }]]), /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'stopped'`）。
   * Result: Return the branch-computed value (`'stopped'`).
   * 验证场景 / Scenario: disabling and re-enabling the scheduler cancels its power query and uses a new signal
   */
  state: () => 'stopped', /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id })`）。
   * Result: Return the branch-computed value (`({ id })`).
   * 验证场景 / Scenario: disabling and re-enabling the scheduler cancels its power query and uses a new signal
   */
  get: () => ({ id }) };
  const workspaces: any = { projects: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'default'`）。
   * Result: Return the branch-computed value (`'default'`).
   * 验证场景 / Scenario: disabling and re-enabling the scheduler cancels its power query and uses a new signal
   */
  current: () => 'default', /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`id`）。
   * Result: Return the branch-computed value (`id`).
   * 验证场景 / Scenario: disabling and re-enabling the scheduler cancels its power query and uses a new signal
   */
  key: () => id } };
  const suite = new FeatureSuite(machines, workspaces, {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: signal。
     * 结果：返回分支计算值（`new Promise((_resolve, reject) => { assert.equal(signal.aborted, false); signal.…`）。
     * Result: Return the branch-computed value (`new Promise((_resolve, reject) => { assert.equal(signal.aborted, false); signal.…`).
     * 验证场景 / Scenario: disabling and re-enabling the scheduler cancels its power query and uses a new signal
     */
    power: (signal) =>
      new Promise((_resolve, reject) => {
        assert.equal(signal.aborted, false);
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('cancelled'));
          },
          { once: true },
        );
        entered();
      }),
  });
  await savePowerPolicy(id, { enabled: true });
  let scheduler = new FeatureScheduler(suite);
  try {
    await waitForPowerQuery(waiting);
    await scheduler.close();
    assert.equal(aborted, true);
    aborted = false;
    const resumed = new Promise<void>((resolve) => {
      entered = resolve;
    });
    scheduler = new FeatureScheduler(suite);
    await waitForPowerQuery(resumed);
    await scheduler.close();
    assert.equal(aborted, true);
  } finally {
    await scheduler.close();
    await suite.close();
  }
});
