/**
 * 模块职责：回归验证模块，围绕 `trusted-boot` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `trusted-boot`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: TPM backend binds a private socket and protects the secure pflash variable store; secure boot requires QMP reboot action support before admitting a VM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';
import { inspectTrustedBoot, supportsQmpRebootAction } from '../server/trusted-boot.ts';
import { trustedBootArguments } from '../server/trusted-boot-service.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: TPM backend binds a private socket and protects the secure pflash variable store
 * 协作入口 / Collaborators: `assert.deepEqual`, `trustedBootArguments`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(trustedBootArguments('/tmp/sakura-tpm-a,b/tpm.sock'), [ '-global', 'driver=cfi.pflash01,property=secure,value=on'…`.
 */
test('TPM backend binds a private socket and protects the secure pflash variable store', () => {
  assert.deepEqual(trustedBootArguments('/tmp/sakura-tpm-a,b/tpm.sock'), [
    '-global', 'driver=cfi.pflash01,property=secure,value=on',
    '-chardev', 'socket,id=sakura-tpm,path=/tmp/sakura-tpm-a,,b/tpm.sock',
    '-tpmdev', 'emulator,id=sakura-tpmdev,chardev=sakura-tpm',
    '-device', 'tpm-tis,tpmdev=sakura-tpmdev',
  ]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: secure boot requires QMP reboot action support before admitting a VM
 * 协作入口 / Collaborators: `assert.equal`, `supportsQmpRebootAction`.
 * 检查边界 / Checked boundaries: `assert.equal(supportsQmpRebootAction('QEMU emulator version 5.2.0'), false)`; `assert.equal(supportsQmpRebootAction('QEMU emulator version 6.0.0'), true)`.
 */
test('secure boot requires QMP reboot action support before admitting a VM', () => {
  assert.equal(supportsQmpRebootAction('QEMU emulator version 5.2.0'), false);
  assert.equal(supportsQmpRebootAction('QEMU emulator version 6.0.0'), true);
  assert.equal(supportsQmpRebootAction('QEMU emulator version 10.2.0 (Debian)'), true);
  assert.equal(supportsQmpRebootAction('not a QEMU version'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: TPM and Secure Boot check separates host prerequisites from guest evidence
 * 状态影响 / State effects: `running`, `response`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `tmpdir`, `inspectTrustedBoot`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(stopped.guest, null)`; `assert.equal(stopped.ready, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('TPM and Secure Boot check separates host prerequisites from guest evidence', async () => {
  const missing = join(tmpdir(), 'sakura-missing-trusted-boot-file');
  let running = false;
  let response = '';
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ firmware: 'uefi' })`）。
     * Result: Return the branch-computed value (`({ firmware: 'uefi' })`).
     * 验证场景 / Scenario: TPM and Secure Boot check separates host prerequisites from guest evidence
     */
    get: () => ({ firmware: 'uefi' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`running ? 'running' : 'stopped'`）。
     * Result: Return the branch-computed value (`running ? 'running' : 'stopped'`).
     * 验证场景 / Scenario: TPM and Secure Boot check separates host prerequisites from guest evidence
     */
    state: () => running ? 'running' : 'stopped',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 0, stdout: response, stderr: '' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stdout: response, stderr: '' })`) through a Promise.
     * 验证场景 / Scenario: TPM and Secure Boot check separates host prerequisites from guest evidence
     */
    exec: async () => ({ code: 0, stdout: response, stderr: '' }),
  } as unknown as Machines;
  const paths = { qemu: missing, secureFirmware: missing,
    varsTemplate: missing, swtpm: missing };
  const stopped = await inspectTrustedBoot(machines, 'vm', paths);
  assert.equal(stopped.guest, null);
  assert.equal(stopped.ready, false);
  assert.equal(stopped.host.tpmBackend, false);
  running = true;
  response = 'EFI=yes\nSecureBoot=0\nSetupMode=1\nTPM=no\n';
  const untrusted = await inspectTrustedBoot(machines, 'vm', paths);
  assert.deepEqual(untrusted.guest, { efi: true, secureBootEnabled: false,
    setupMode: true, tpmDevicePresent: false });
  assert.equal(untrusted.ready, false);
  response = 'EFI=yes\nSecureBoot=1\nSetupMode=0\nTPM=yes\n';
  const trusted = await inspectTrustedBoot(machines, 'vm', paths);
  assert.equal(trusted.observed, true);
  assert.equal(trusted.ready, false);
  assert.equal(trusted.guest?.setupMode, false);
});
