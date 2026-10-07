/**
 * 模块职责：回归验证模块，围绕 `media-devices` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `media-devices`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: HDA audio uses the selected host backend and rejects unsupported ARM64 PCI profiles; media settings preview reviewed audio changes and forward typed USB media rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSchema } from '../server/model.ts';
import { audioArguments } from '../shared/hardware.ts';
import { MediaDevices } from '../server/media-devices.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HDA audio uses the selected host backend and rejects unsupported ARM64 PCI profiles
 * 协作入口 / Collaborators: `createSchema.parse`, `assert.deepEqual`, `audioArguments`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(audioArguments(config), ['-audiodev', 'dsound,id=sakura-audio', '-device', 'ich9-intel-hda', '-device', 'hda-dupl…`; `assert.equal(createSchema.safeParse({ name: 'arm-media', architecture: 'aarch64', distro: 'debian', firmware: 'uefi', hardware: { …`.
 */
test('HDA audio uses the selected host backend and rejects unsupported ARM64 PCI profiles', () => {
  const config = createSchema.parse({ name: 'media', hardware: { devices: {
    audio: 'hda-duplex', audioBackend: 'dsound' } } });
  assert.deepEqual(audioArguments(config), ['-audiodev', 'dsound,id=sakura-audio',
    '-device', 'ich9-intel-hda', '-device', 'hda-duplex,audiodev=sakura-audio']);
  assert.equal(createSchema.safeParse({ name: 'arm-media', architecture: 'aarch64',
    distro: 'debian', firmware: 'uefi', hardware: { devices: {
      audio: 'hda-duplex', audioBackend: 'dsound' } } }).success, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: media settings preview reviewed audio changes and forward typed USB media rules
 * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `media.action`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(unavailable.ready, false)`; `assert.match(unavailable.reasons.join(' '), /host playback unavailable/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('media settings preview reviewed audio changes and forward typed USB media rules', async () => {
  const vmId = randomUUID();
  const vm = { id: vmId, name: 'media-vm', memoryMiB: 1024,
    architecture: 'x86_64' as const, hardware: undefined as any };
  let status = 'stopped';
  const usbActions: unknown[] = [];
  const usbView = { ready: false, hostDevices: '', hostError: '',
    rules: [], configured: [], events: [] };
  const usb = { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`usbView`），以 Promise 交付。
   * Result: Return the branch-computed value (`usbView`) through a Promise.
   * 验证场景 / Scenario: media settings preview reviewed audio changes and forward typed USB media rules
   */
  view: async () => usbView,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; input: unknown。
     * 结果：返回分支计算值（`usbView`），以 Promise 交付。
     * Result: Return the branch-computed value (`usbView`) through a Promise.
     * 验证场景 / Scenario: media settings preview reviewed audio changes and forward typed USB media rules
     * 协作入口 / Collaborators: `usbActions.push`.
     */
    action: async (_id: string, input: unknown) => { usbActions.push(input); return usbView; } } as any;
  const machines = { records: new Map([[vmId, vm]]), /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`vm`）。
   * Result: Return the branch-computed value (`vm`).
   * 验证场景 / Scenario: media settings preview reviewed audio changes and forward typed USB media rules
   */
  get: () => vm,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`status`）。
     * Result: Return the branch-computed value (`status`).
     * 验证场景 / Scenario: media settings preview reviewed audio changes and forward typed USB media rules
     */
    state: () => status, /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: media settings preview reviewed audio changes and forward typed USB media rules
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _id: string; hardware: unknown; expected: any。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: media settings preview reviewed audio changes and forward typed USB media rules
     * 状态影响 / State effects: `vm.hardware`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.deepEqual`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(expected.hardware, vm.hardware || {})`.
     */
    configureHardware: async (_id: string, hardware: unknown, expected: any) => {
      assert.deepEqual(expected.hardware, vm.hardware || {});
      vm.hardware = hardware;
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 0, stdout: 'AUDIO\n0 [HDA]: HDA\nVIDEO\n/dev/video0\n', stderr: '' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stdout: 'AUDIO\n0 [HDA]: HDA\nVIDEO\n/dev/video0\n', stderr: '' })`) through a Promise.
     * 验证场景 / Scenario: media settings preview reviewed audio changes and forward typed USB media rules
     */
    exec: async () => ({ code: 0,
      stdout: 'AUDIO\n0 [HDA]: HDA\nVIDEO\n/dev/video0\n', stderr: '' }),
  } as any;
  const media = new MediaDevices(machines, usb, undefined, undefined,
    async (_machines, backend) => ({ available: backend !== 'dsound',
      ...(backend === 'dsound' ? { reason: 'host playback unavailable' } : {}) }));
  const unavailable = await media.action(vmId,
    { operation: 'preview-audio', mode: 'host' }) as { ready: boolean; reasons: string[] };
  assert.equal(unavailable.ready, false);
  assert.match(unavailable.reasons.join(' '), /host playback unavailable/);
  const preview = await media.action(vmId,
    { operation: 'preview-audio', mode: 'virtual' }) as { ready: boolean;
      previewToken: string; qemuAudioArguments: string[] };
  assert.equal(preview.ready, true);
  assert.match(preview.qemuAudioArguments.join(' '), /hda-duplex/);
  await assert.rejects(media.action(vmId, { operation: 'apply-audio', mode: 'virtual',
    previewToken: '0'.repeat(64) }), /预览已过期/);
  await media.action(vmId, { operation: 'apply-audio', mode: 'virtual',
    previewToken: preview.previewToken });
  assert.equal(vm.hardware.devices.audio, 'hda-duplex');
  assert.equal(vm.hardware.devices.audioBackend, 'none');
  await media.action(vmId, { operation: 'save-usb', kind: 'camera',
    vendorId: 0x1234, productId: 0x5678 });
  assert.deepEqual(usbActions[0], { operation: 'save-rule', mediaKind: 'camera',
    vendorId: 0x1234, productId: 0x5678 });
  status = 'running';
  const view = await media.view(vmId);
  assert.match(view.guest?.audio || '', /HDA/);
  assert.match(view.guest?.video || '', /video0/);
  await media.action(vmId, { operation: 'attach-usb', ruleId: randomUUID() });
  assert.equal((usbActions[1] as any).operation, 'apply-rule');
  media.close();
});
