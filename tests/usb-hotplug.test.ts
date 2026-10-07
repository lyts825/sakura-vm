/**
 * 模块职责：回归验证模块，围绕 `usb-hotplug` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `usb-hotplug`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: USB rules reapply after a VM restart and manual devices remain temporary; USB forwarding records a QMP failure without claiming a configured device.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Machines } from '../server/machines.ts';
import { UsbHotplug } from '../server/usb-hotplug.ts';
import type { qmp } from '../server/qmp.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: USB rules reapply after a VM restart and manual devices remain temporary
 * 状态影响 / State effects: `view`, `fake.live.get(vmId)!.startedAt`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal(view.rules.length, 1)`; `assert.equal(view.configured.length, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('USB rules reapply after a VM restart and manual devices remain temporary', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-usb-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vmId = randomUUID();
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const fake = Object.assign(new EventEmitter(), {
    live: new Map<string, { status: string; startedAt: string; qmpPort: number }>(
      [[vmId, { status: 'running', startedAt: 'boot-1', qmpPort: 1234 }]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回受控对象，公开字段包括 `architecture`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `architecture`; the actual branch determines its shape.
     * 验证场景 / Scenario: USB rules reapply after a VM restart and manual devices remain temporary
     * 失败 / Failure: `new Error('Unknown VM')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    get(id: string) {
      if (id !== vmId) throw new Error('Unknown VM');
      return { architecture: 'x86_64' };
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`this.live.has(id) ? 'running' : 'stopped'`）。
     * Result: Return the branch-computed value (`this.live.has(id) ? 'running' : 'stopped'`).
     * 验证场景 / Scenario: USB rules reapply after a VM restart and manual devices remain temporary
     * 协作入口 / Collaborators: `this.live.has`.
     */
    state(id: string) { return this.live.has(id) ? 'running' : 'stopped'; },
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: USB rules reapply after a VM restart and manual devices remain temporary
     */
    requireUnlocked() {},
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     * 验证场景 / Scenario: USB rules reapply after a VM restart and manual devices remain temporary
     */
    incidentLocked() { return false; },
  }) as unknown as Machines;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _port: number; command: string; args: Record<string, unknown>。
   * 结果：返回分支计算值（`command === 'human-monitor-command' ? 'Device 1.2, USB device 1234:5678' : {}`），以 Promise 交付。
   * Result: Return the branch-computed value (`command === 'human-monitor-command' ? 'Device 1.2, USB device 1234:5678' : {}`) through a Promise.
   * 验证场景 / Scenario: USB rules reapply after a VM restart and manual devices remain temporary
   * 协作入口 / Collaborators: `calls.push`.
   */
  const execute = (async (_port: number, command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return command === 'human-monitor-command' ? 'Device 1.2, USB device 1234:5678' : {};
  }) as typeof qmp;
  const file = join(root, 'usb.json');
  const usb = new UsbHotplug(fake, file, undefined, undefined, execute);
  await usb.init();
  try {
    let view = await usb.action(vmId, { operation: 'save-rule', vendorId: 0x1234, productId: 0x5678 });
    assert.equal(view.rules.length, 1);
    assert.equal(view.configured.length, 1);
    assert.equal(calls.filter((call) => call.command === 'device_add').length, 1);
    const ruleId = view.rules[0].id;
    view = await usb.action(vmId, { operation: 'detach', deviceId: view.configured[0].id });
    assert.equal(view.configured.length, 0);
    assert.equal(view.rules.length, 1);
    view = await usb.action(vmId, { operation: 'attach', vendorId: 0xabcd, productId: 0x0102 });
    assert.equal(view.configured.length, 1);
    fake.live.get(vmId)!.startedAt = 'boot-2';
    await usb.reconcile();
    view = await usb.view(vmId);
    assert.equal(view.configured.length, 1);
    assert.equal(view.configured[0].ruleId, ruleId);
    assert.equal(calls.filter((call) => call.command === 'device_add').length, 3);
    assert.equal(view.hostDevices.includes('1234:5678'), true);
    await assert.rejects(usb.action(vmId, { operation: 'attach', vendorId: 0, productId: 1 }));
    view = await usb.action(vmId, { operation: 'remove-rule', id: ruleId });
    assert.equal(view.rules.length, 0);
    assert.equal(view.configured.length, 0);
    assert.equal(calls.filter((call) => call.command === 'device_del').length, 2);
  } finally { await usb.close(); }
  const resumed = new UsbHotplug(fake, file, undefined, undefined, execute);
  await resumed.init();
  try {
    const view = await resumed.view(vmId);
    assert.equal(view.rules.length, 0);
    assert.ok(view.events.length >= 5);
  } finally { await resumed.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: USB forwarding records a QMP failure without claiming a configured device
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.rejects(usb.action(vmId, { operation: 'save-rule', vendorId: 0x1234, productId: 0x5678 }), /physical device unavailable/)`; `assert.equal(view.rules.length, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('USB forwarding records a QMP failure without claiming a configured device', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-usb-error-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vmId = randomUUID();
  const fake = Object.assign(new EventEmitter(), {
    live: new Map<string, { status: string; startedAt: string; qmpPort: number }>(
      [[vmId, { status: 'running', startedAt: 'boot-1', qmpPort: 1234 }]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `architecture`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `architecture`; the actual branch determines its shape.
     * 验证场景 / Scenario: USB forwarding records a QMP failure without claiming a configured device
     */
    get() { return { architecture: 'x86_64' }; },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: USB forwarding records a QMP failure without claiming a configured device
     */
    state() { return 'running'; },
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: USB forwarding records a QMP failure without claiming a configured device
     */
    requireUnlocked() {},
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     * 验证场景 / Scenario: USB forwarding records a QMP failure without claiming a configured device
     */
    incidentLocked() { return false; },
  }) as unknown as Machines;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _port: number; command: string。
   * 结果：返回分支计算值（`''`），以 Promise 交付。
   * Result: Return the branch-computed value (`''`) through a Promise.
   * 验证场景 / Scenario: USB forwarding records a QMP failure without claiming a configured device
   * 失败 / Failure: `new Error('physical device unavailable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  const execute = (async (_port: number, command: string) => {
    if (command === 'device_add') throw new Error('physical device unavailable');
    return '';
  }) as typeof qmp;
  const usb = new UsbHotplug(fake, join(root, 'usb.json'), undefined, undefined, execute);
  await usb.init();
  try {
    await assert.rejects(usb.action(vmId,
      { operation: 'save-rule', vendorId: 0x1234, productId: 0x5678 }), /physical device unavailable/);
    const view = await usb.view(vmId);
    assert.equal(view.rules.length, 1);
    assert.equal(view.configured.length, 0);
    assert.equal(view.events[0].status, 'failed');
    assert.match(view.events[0].error || '', /physical device unavailable/);
  } finally { await usb.close(); }
});
