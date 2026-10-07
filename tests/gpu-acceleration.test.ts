/**
 * 模块职责：回归验证模块，围绕 `gpu-acceleration` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `gpu-acceleration`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: GPU readiness rejects a software renderer even when EGL exits successfully; GPU readiness accepts GBM virtio_gpu with VirGL negotiation when renderer is absent.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGpuAcceleration, runGpuAcceleration } from '../server/gpu-acceleration.ts';
import type { Machines } from '../server/machines.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPU readiness rejects a software renderer even when EGL exits successfully
 * 协作入口 / Collaborators: `checkGpuAcceleration`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ready, false)`; `assert.match(result.reason, /不是 VirGL/)`.
 */
test('GPU readiness rejects a software renderer even when EGL exits successfully', async () => {
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ hardware: { devices: { graphics: 'virgl' } } })`）。
     * Result: Return the branch-computed value (`({ hardware: { devices: { graphics: 'virgl' } } })`).
     * 验证场景 / Scenario: GPU readiness rejects a software renderer even when EGL exits successfully
     */
    get: () => ({ hardware: { devices: { graphics: 'virgl' } } }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: GPU readiness rejects a software renderer even when EGL exits successfully
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 0, stdout: 'OpenGL renderer: llvmpipe (LLVM 21)\n', stderr: '' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stdout: 'OpenGL renderer: llvmpipe (LLVM 21)\n', stderr: '' })`) through a Promise.
     * 验证场景 / Scenario: GPU readiness rejects a software renderer even when EGL exits successfully
     */
    exec: async () => ({ code: 0, stdout: 'OpenGL renderer: llvmpipe (LLVM 21)\n', stderr: '' }),
  } as unknown as Machines;
  const result = await checkGpuAcceleration(machines, 'vm');
  assert.equal(result.ready, false);
  assert.match(result.reason, /不是 VirGL/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPU readiness accepts GBM virtio_gpu with VirGL negotiation when renderer is absent
 * 协作入口 / Collaborators: `checkGpuAcceleration`, `assert.equal`, `assert.ok`, `commands.some`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ready, true)`; `assert.equal(result.verifiedBy, 'gbm-driver-and-virgl-device')`.
 */
test('GPU readiness accepts GBM virtio_gpu with VirGL negotiation when renderer is absent', async () => {
  const commands: string[] = [];
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ hardware: { devices: { graphics: 'virgl' } } })`）。
     * Result: Return the branch-computed value (`({ hardware: { devices: { graphics: 'virgl' } } })`).
     * 验证场景 / Scenario: GPU readiness accepts GBM virtio_gpu with VirGL negotiation when renderer is absent
     */
    get: () => ({ hardware: { devices: { graphics: 'virgl' } } }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: GPU readiness accepts GBM virtio_gpu with VirGL negotiation when renderer is absent
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: GPU readiness accepts GBM virtio_gpu with VirGL negotiation when renderer is absent
     * 协作入口 / Collaborators: `commands.push`, `command.includes`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: command.includes('eglinfo') ?
        'GBM platform:\nEGL API version: 1.4\nEGL driver name: virtio_gpu\n' : '', stderr: '' };
    },
  } as unknown as Machines;
  const result = await checkGpuAcceleration(machines, 'vm');
  assert.equal(result.ready, true);
  assert.equal(result.verifiedBy, 'gbm-driver-and-virgl-device');
  assert.ok(commands.some((command) => command.includes('features: +virgl')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPU readiness does not accept software renderer from a VirGL capable device
 * 协作入口 / Collaborators: `checkGpuAcceleration`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ready, false)`.
 */
test('GPU readiness does not accept software renderer from a VirGL capable device', async () => {
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ hardware: { devices: { graphics: 'virgl' } } })`）。
     * Result: Return the branch-computed value (`({ hardware: { devices: { graphics: 'virgl' } } })`).
     * 验证场景 / Scenario: GPU readiness does not accept software renderer from a VirGL capable device
     */
    get: () => ({ hardware: { devices: { graphics: 'virgl' } } }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: GPU readiness does not accept software renderer from a VirGL capable device
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回分支计算值（`({ code: 0, stdout: command.includes('eglinfo') ? 'GBM platform:\nEGL API versio…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stdout: command.includes('eglinfo') ? 'GBM platform:\nEGL API versio…`) through a Promise.
     * 验证场景 / Scenario: GPU readiness does not accept software renderer from a VirGL capable device
     * 协作入口 / Collaborators: `command.includes`.
     */
    exec: async (_id: string, command: string) => ({ code: 0,
      stdout: command.includes('eglinfo') ?
        'GBM platform:\nEGL API version: 1.4\nEGL driver name: virtio_gpu\nrenderer: llvmpipe\n' : '',
      stderr: '' }),
  } as unknown as Machines;
  const result = await checkGpuAcceleration(machines, 'vm');
  assert.equal(result.ready, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VirGL setup only runs for a configured, running instance
 * 状态影响 / State effects: `graphics`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `assert.rejects`, `runGpuAcceleration`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runGpuAcceleration(machines, 'vm', { mode: 'install-mesa' }), /选择 VirGL/)`; `assert.equal(calls, 0)`.
 */
test('VirGL setup only runs for a configured, running instance', async () => {
  let calls = 0;
  let graphics: 'none' | 'virgl' = 'none';
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ hardware: { devices: { graphics } } })`）。
     * Result: Return the branch-computed value (`({ hardware: { devices: { graphics } } })`).
     * 验证场景 / Scenario: VirGL setup only runs for a configured, running instance
     */
    get: () => ({ hardware: { devices: { graphics } } }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: VirGL setup only runs for a configured, running instance
     */
    state: () => 'running',
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: VirGL setup only runs for a configured, running instance
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: VirGL setup only runs for a configured, running instance
     */
    exec: async () => {
      calls++;
      return { code: 0, stdout: 'OpenGL renderer: virgl (host GPU)\n', stderr: '' };
    },
  } as unknown as Machines;
  await assert.rejects(runGpuAcceleration(machines, 'vm', { mode: 'install-mesa' }), /选择 VirGL/);
  assert.equal(calls, 0);
  graphics = 'virgl';
  const result = await runGpuAcceleration(machines, 'vm', { mode: 'install-mesa' });
  assert.equal(result.ready, true);
  assert.equal(result.executed, true);
  assert.equal(calls, 3);
});
