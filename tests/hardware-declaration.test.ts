/**
 * 模块职责：回归验证模块，围绕 `hardware-declaration` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `hardware-declaration`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: compute check needs a real driver query and guest device nodes; PCI and USB declaration previews never mutate host or VM devices.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { gpuComputeStatus } from '../server/gpu-compute.ts';
import { devicePassthroughPreview, devicePassthroughInput } from '../server/device-passthrough-preview.ts';
import { VtpmEnrollment } from '../server/vtpm-enrollment.ts';
import type { Machines } from '../server/machines.ts';

const id = '11111111-1111-4111-8111-111111111111';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: compute check needs a real driver query and guest device nodes
 * 状态影响 / State effects: `running`, `nvidia`, `nodes`, `rocm`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `assert.equal`, `gpuComputeStatus`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.equal((await gpuComputeStatus(machines, id, {}, 'check')).ready, false)`; `assert.equal((await gpuComputeStatus(machines, id, { provider: 'cuda' }, 'check')).ready, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('compute check needs a real driver query and guest device nodes', async () => {
  let running = false;
  let nodes = false;
  let nvidia = false;
  let rocm = false;
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id })`）。
     * Result: Return the branch-computed value (`({ id })`).
     * 验证场景 / Scenario: compute check needs a real driver query and guest device nodes
     */
    get: () => ({ id }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`(running ? 'running' : 'stopped')`）。
     * Result: Return the branch-computed value (`(running ? 'running' : 'stopped')`).
     * 验证场景 / Scenario: compute check needs a real driver query and guest device nodes
     */
    state: () => (running ? 'running' : 'stopped'),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: compute check needs a real driver query and guest device nodes
     * 协作入口 / Collaborators: `command.includes`.
     */
    exec: async (_id: string, command: string) => {
      if (command.includes('nvidia-smi'))
        return { code: nvidia ? 0 : 127, stdout: nvidia ? 'NVIDIA A10, GPU-123\n' : '', stderr: '' };
      if (command.includes('rocminfo'))
        return { code: rocm ? 0 : 127, stdout: rocm ? 'Device Type: GPU\nName: gfx1030\n' : '', stderr: '' };
      return { code: nodes ? 0 : 1, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  assert.equal((await gpuComputeStatus(machines, id, {}, 'check')).ready, false);
  running = true;
  nvidia = true;
  assert.equal((await gpuComputeStatus(machines, id, { provider: 'cuda' }, 'check')).ready, false);
  nodes = true;
  const cuda = await gpuComputeStatus(machines, id, { provider: 'cuda' }, 'run');
  assert.equal(cuda.ready, true);
  assert.equal(cuda.cuda?.devices[0], 'NVIDIA A10, GPU-123');
  nvidia = false;
  rocm = true;
  assert.equal((await gpuComputeStatus(machines, id, { provider: 'auto' }, 'check')).ready, true);
  await assert.rejects(gpuComputeStatus(machines, id, { provider: 'invalid' }, 'check'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: PCI and USB declaration previews never mutate host or VM devices
 * 协作入口 / Collaborators: `devicePassthroughPreview`, `assert.equal`, `devicePassthroughInput.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(usb.ready, true)`; `assert.equal(usb.prerequisitesMet, true)`.
 */
test('PCI and USB declaration previews never mutate host or VM devices', async () => {
  let calls = 0;
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ architecture: 'x86_64' })`）。
     * Result: Return the branch-computed value (`({ architecture: 'x86_64' })`).
     * 验证场景 / Scenario: PCI and USB declaration previews never mutate host or VM devices
     */
    get: () => ({ architecture: 'x86_64' }),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: PCI and USB declaration previews never mutate host or VM devices
     * 失败 / Failure: `new Error('preview must be read-only')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    exec: async () => {
      calls++;
      throw new Error('preview must be read-only');
    },
  } as unknown as Machines;
  const usb = await devicePassthroughPreview(
    machines,
    id,
    { mode: 'preview', device: { kind: 'usb', vendorId: 0x1234, productId: 0x5678 } },
    'run',
    '/nonexistent',
    'win32',
  );
  assert.equal(usb.ready, true);
  assert.equal(usb.prerequisitesMet, true);
  assert.equal(usb.checks.hostDevicePresent, null);
  const pci = await devicePassthroughPreview(
    machines,
    id,
    { mode: 'preview', device: { kind: 'pci', address: '0000:01:00.0' } },
    'run',
    '/nonexistent',
    'win32',
  );
  assert.equal(pci.prerequisitesMet, false);
  assert.equal(pci.checks.linuxHost, false);
  assert.equal(calls, 0);
  assert.equal(
    devicePassthroughInput.safeParse({ mode: 'preview', device: { kind: 'pci', address: '0000:01:00.0;rm' } })
      .success,
    false,
  );
  assert.equal(
    devicePassthroughInput.safeParse({ mode: 'preview', device: { kind: 'usb', vendorId: 0, productId: 1 } })
      .success,
    false,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: vTPM enrollment persists public fingerprints and computes rotation reminders
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))`; `assert.equal(preview.records.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('vTPM enrollment persists public fingerprints and computes rotation reminders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-vtpm-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  const file = join(root, 'enrollment.json');
  const machines = { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id })`）。
   * Result: Return the branch-computed value (`({ id })`).
   * 验证场景 / Scenario: vTPM enrollment persists public fingerprints and computes rotation reminders
   */
  get: () => ({ id }) } as unknown as Machines;
  const fingerprint = 'a'.repeat(64);
  const service = new VtpmEnrollment(machines, file);
  try {
    await service.init();
    const input = {
      mode: 'save',
      fingerprint,
      label: 'Signing key',
      enrolledAt: '2020-01-01T00:00:00.000Z',
      rotateAfterDays: 365,
    };
    const preview = await service.action(id, input, 'check');
    assert.equal(preview.records.length, 0);
    assert.equal((preview as { preview?: { rotateDueAt: string } }).preview?.rotateDueAt,
      '2020-12-31T00:00:00.000Z');
    await service.action(id, input, 'run');
    assert.equal(service.status(id).overdueCount, 1);
    assert.equal(service.status(id).records[0].fingerprint, fingerprint);
    await assert.rejects(service.action(id, { ...input, privateKey: 'secret' }, 'run'));
    await service.close();
    const restored = new VtpmEnrollment(machines, file);
    await restored.init();
    assert.equal(restored.status(id).records.length, 1);
    await restored.action(id, { mode: 'remove', fingerprint }, 'run');
    assert.equal(restored.status(id).records.length, 0);
    await restored.close();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
