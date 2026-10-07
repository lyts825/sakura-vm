/**
 * 模块职责：回归验证模块，围绕 `ha-failure-monitor` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-failure-monitor`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: HA counter arms only after running and ignores planned stops; HA counter detects consecutive failed samples and resets on recovery.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { advanceHaMonitor, HaFailureMonitor } from '../server/ha-failure-monitor.ts';
import type { Machines } from '../server/machines.ts';
import type { VMStatus } from '../server/model.ts';

const hostId = randomUUID();
const policy = { enabled: true, options: { targetHostId: hostId, failureThreshold: 3 } };
const at = '2026-09-29T00:00:00.000Z';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HA counter arms only after running and ignores planned stops
 * 协作入口 / Collaborators: `advanceHaMonitor`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(unarmed.consecutiveFailures, 0)`; `assert.equal(running.armed, true)`.
 */
test('HA counter arms only after running and ignores planned stops', () => {
  const unarmed = advanceHaMonitor(undefined, 'stopped', policy, at, true);
  assert.equal(unarmed.consecutiveFailures, 0);
  const running = advanceHaMonitor(unarmed, 'running', policy, at, false);
  assert.equal(running.armed, true);
  const stopping = advanceHaMonitor(running, 'stopping', policy, at, false);
  const stopped = advanceHaMonitor(stopping, 'stopped', policy, at, true);
  assert.equal(stopped.armed, false);
  assert.equal(stopped.consecutiveFailures, 0);
  assert.equal(stopped.suspectedAt, undefined);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HA counter detects consecutive failed samples and resets on recovery
 * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `advanceHaMonitor`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(status.consecutiveFailures, i)`; `assert.equal(status.suspectedAt, at)`.
 */
test('HA counter detects consecutive failed samples and resets on recovery', () => {
  let status = advanceHaMonitor(undefined, 'running', policy, at, false);
  for (let i = 1; i <= 3; i++) {
    status = advanceHaMonitor(status, 'error', policy, at, true);
    assert.equal(status.consecutiveFailures, i);
  }
  assert.equal(status.suspectedAt, at);
  status = advanceHaMonitor(status, 'running', policy, at, true);
  assert.equal(status.consecutiveFailures, 0);
  assert.equal(status.suspectedAt, undefined);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HA counter never carries failure evidence into a new policy revision
 * 协作入口 / Collaborators: `advanceHaMonitor`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(revised.armed, false)`; `assert.equal(revised.consecutiveFailures, 0)`.
 */
test('HA counter never carries failure evidence into a new policy revision', () => {
  const oldPolicy = { ...policy, updatedAt: '2026-09-29T00:00:00.000Z' };
  const revisedPolicy = { ...policy, updatedAt: '2026-09-29T01:00:00.000Z' };
  const running = advanceHaMonitor(undefined, 'running', oldPolicy, at, false);
  const failed = advanceHaMonitor(running, 'error', oldPolicy, at, true);
  const revised = advanceHaMonitor(failed, 'error', revisedPolicy, at, true);
  assert.equal(revised.armed, false);
  assert.equal(revised.consecutiveFailures, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HA background monitor persists failure evidence and disarms on policy changes
 * 状态影响 / State effects: `machine.state`, `vmState`, `settings`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.equal(monitor.view(id)?.armed, false)`; `assert.equal(monitor.view(id)?.armed, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('HA background monitor persists failure evidence and disarms on policy changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sakura-ha-monitor-'));
  const file = join(dir, 'monitor.json');
  const id = randomUUID();
  const machine = new EventEmitter() as EventEmitter & { state: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: id: string。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (id: string) => VMStatus };
  let vmState: VMStatus = 'stopped';
  machine.state = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`vmState`）。
   * Result: Return the branch-computed value (`vmState`).
   * 验证场景 / Scenario: HA background monitor persists failure evidence and disarms on policy changes
   */
  () => vmState;
  let settings = { ...policy };
  const monitor = new HaFailureMonitor(machine as Machines,
    async () => ({ [id]: settings }), file);
  try {
    await monitor.init();
    assert.equal(monitor.view(id)?.armed, false);
    vmState = 'running';
    machine.emit('change');
    await monitor.sample();
    assert.equal(monitor.view(id)?.armed, true);
    vmState = 'error';
    machine.emit('change');
    await monitor.sample();
    await monitor.sample();
    await monitor.sample();
    assert.equal(monitor.view(id)?.consecutiveFailures, 3);
    assert.equal(monitor.view(id)?.suspected, true);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(stored[id].consecutiveFailures, 3);
    settings = { enabled: false, options: policy.options };
    await monitor.reconfigure(id);
    assert.equal(monitor.view(id)?.armed, false);
    assert.equal(monitor.view(id)?.consecutiveFailures, 0);
  } finally {
    await monitor.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HA background monitor records an intentional stop even if the VM exits before stopping state
 * 状态影响 / State effects: `machine.state`, `vmState`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.equal(monitor.view(id)?.armed, false)`; `assert.equal(monitor.view(id)?.armed, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('HA background monitor records an intentional stop even if the VM exits before stopping state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sakura-ha-stop-'));
  const id = randomUUID();
  const machine = new EventEmitter() as EventEmitter & { state: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: id: string。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (id: string) => VMStatus };
  let vmState: VMStatus = 'running';
  machine.state = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`vmState`）。
   * Result: Return the branch-computed value (`vmState`).
   * 验证场景 / Scenario: HA background monitor records an intentional stop even if the VM exits before stopping state
   */
  () => vmState;
  const monitor = new HaFailureMonitor(machine as Machines,
    async () => ({ [id]: policy }), join(dir, 'monitor.json'));
  try {
    await monitor.init();
    machine.emit('stop-requested', id);
    assert.equal(monitor.view(id)?.armed, false);
    vmState = 'stopped';
    machine.emit('change');
    await monitor.sample();
    assert.equal(monitor.view(id)?.armed, false);
    assert.equal(monitor.view(id)?.consecutiveFailures, 0);
  } finally {
    await monitor.close();
    await rm(dir, { recursive: true, force: true });
  }
});
