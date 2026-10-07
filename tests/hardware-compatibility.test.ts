/**
 * 模块职责：回归验证模块，围绕 `hardware-compatibility` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `hardware-compatibility`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: matrix reports actual QEMU devices and distinguishes WHPX startup verification from binary support; matrix identifies missing selected devices, incompatible accelerators and invalid NUMA without claiming guest support.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchema } from '../server/model.ts';
import { hardwareCompatibility } from '../server/hardware-compatibility.ts';
import type { Machines } from '../server/machines.ts';

const deviceOutput = [
  'name "virtio-net-pci", bus PCI',
  'name "e1000", bus PCI',
  'name "virtio-rng-pci", bus PCI',
  'name "virtio-balloon-pci", bus PCI',
  'name "pc-dimm", desc "DIMM"',
].join('\n');
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: options: { devices?: string; accelerators?: string; machine?: string; whpx… = {}。
 * 结果：返回受控对象，公开字段包括 `machines, calls`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, calls`; the actual branch determines its shape.
 */
function fixture(
  options: {
    devices?: string;
    accelerators?: string;
    machine?: string;
    whpx?: boolean;
    config?: Record<string, unknown>;
  } = {},
) {
  const calls: string[] = [];
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`createSchema.parse({ name: 'matrix-vm', ...options.config })`）。
     * Result: Return the branch-computed value (`createSchema.parse({ name: 'matrix-vm', ...options.config })`).
     * 协作入口 / Collaborators: `createSchema.parse`.
     */
    get: () => createSchema.parse({ name: 'matrix-vm', ...options.config }),
    engine: {
      version: 'QEMU test',
      whpxAvailable: options.whpx ?? false,
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _tool: string; args: string[]。
       * 结果：返回分支计算值（`options.devices ?? deviceOutput / options.accelerators ?? 'Accelerators supported in QEMU binary:\ntcg\nwhpx'`），以 Promise 交付。
       * Result: Return the branch-computed value (`options.devices ?? deviceOutput / options.accelerators ?? 'Accelerators supported in QEMU binary:\ntcg\nwhpx'`) through a Promise.
       * 协作入口 / Collaborators: `calls.push`, `args.join`.
       */
      run: async (_tool: string, args: string[]) => {
        calls.push(args.join(' '));
        if (args[0] === '-device') return options.devices ?? deviceOutput;
        if (args[0] === '-accel')
          return options.accelerators ?? 'Accelerators supported in QEMU binary:\ntcg\nwhpx';
        return options.machine ?? 'pc-q35-11.0 Standard PC';
      },
    },
  } as unknown as Machines;
  return { machines, calls };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: matrix reports actual QEMU devices and distinguishes WHPX startup verification from binary support
 * 协作入口 / Collaborators: `fixture`, `hardwareCompatibility`, `assert.deepEqual`, `calls.sort`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(calls.sort(), ['-accel help', '-device help', '-machine help'])`; `assert.equal(report.ready, true)`.
 */
test('matrix reports actual QEMU devices and distinguishes WHPX startup verification from binary support', async () => {
  const { machines, calls } = fixture();
  const report = await hardwareCompatibility(machines, 'vm');
  assert.deepEqual(calls.sort(), ['-accel help', '-device help', '-machine help']);
  assert.equal(report.ready, true);
  assert.equal(report.current.compatible, true);
  assert.equal(report.current.accelerator, 'tcg');
  assert.equal(report.matrix.accelerators.find((row) => row.id === 'whpx')?.available, false);
  assert.equal(report.matrix.devices.find((row) => row.id === 'pc-dimm')?.available, true);
  assert.match(report.limitation, /客户机驱动/);
  const onWhpx = await hardwareCompatibility(fixture({ whpx: true }).machines, 'vm');
  assert.equal(onWhpx.current.accelerator, 'whpx');
  assert.equal(onWhpx.matrix.accelerators.find((row) => row.id === 'whpx')?.available, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: matrix identifies missing selected devices, incompatible accelerators and invalid NUMA without claiming guest support
 * 状态影响 / State effects: `machines.get`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `deviceOutput.replace`, `machines.get`, `hardwareCompatibility`.
 * 检查边界 / Checked boundaries: `assert.equal(report.ready, true)`; `assert.equal(report.current.compatible, false)`.
 */
test('matrix identifies missing selected devices, incompatible accelerators and invalid NUMA without claiming guest support', async () => {
  const { machines } = fixture({
    devices: deviceOutput.replace('name "e1000", bus PCI\n', ''),
    config: {
      accelerator: 'whpx',
      hardware: {
        devices: { networkCard: 'e1000' },
      },
    },
  });
  const valid = machines.get('vm');
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...valid, hardware: { ...valid.hardware, cpu: { sockets: 1, cores: 2, threads…`）。
   * Result: Return the branch-computed value (`({ ...valid, hardware: { ...valid.hardware, cpu: { sockets: 1, cores: 2, threads…`).
   * 验证场景 / Scenario: matrix identifies missing selected devices, incompatible accelerators and invalid NUMA without claiming guest support
   */
  () => ({
    ...valid,
    hardware: {
      ...valid.hardware,
      cpu: { sockets: 1, cores: 2, threads: 1, numa: [{ memoryMiB: 512, cpus: [0] }] },
    },
  });
  const report = await hardwareCompatibility(machines, 'vm');
  assert.equal(report.ready, true);
  assert.equal(report.current.compatible, false);
  assert.match(report.current.issues.join('\n'), /WHPX|whpx/);
  assert.match(report.current.issues.join('\n'), /e1000/);
  assert.match(report.current.issues.join('\n'), /NUMA/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed QEMU probes are visible and prevent a successful report; cancellation is propagated
 * 状态影响 / State effects: `machines.engine.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `hardwareCompatibility`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(report.ready, false)`; `assert.equal(report.current.compatible, false)`.
 */
test('failed QEMU probes are visible and prevent a successful report; cancellation is propagated', async () => {
  const { machines } = fixture();
  machines.engine.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _tool; args。
   * 结果：返回分支计算值（`args[0] === '-accel' ? 'tcg' : 'pc-q35-11.0'`），以 Promise 交付。
   * Result: Return the branch-computed value (`args[0] === '-accel' ? 'tcg' : 'pc-q35-11.0'`) through a Promise.
   * 验证场景 / Scenario: failed QEMU probes are visible and prevent a successful report; cancellation is propagated
   * 失败 / Failure: `new Error('QEMU device probe unavailable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async (_tool, args) => {
    if (args[0] === '-device') throw new Error('QEMU device probe unavailable');
    return args[0] === '-accel' ? 'tcg' : 'pc-q35-11.0';
  };
  const report = await hardwareCompatibility(machines, 'vm');
  assert.equal(report.ready, false);
  assert.equal(report.current.compatible, false);
  assert.match(report.matrix.devices[0].reason || '', /device probe unavailable/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(hardwareCompatibility(machines, 'vm', abort.signal), { name: 'AbortError' });
});
