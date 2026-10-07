/**
 * 模块职责：回归验证模块，围绕 `arm64` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `arm64`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: ARM64 instances require a matching Debian image, UEFI and TCG-compatible acceleration; ARM64 cloud-init writes the readiness marker to the PL011 serial device.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchema } from '../server/model.ts';
import { distroInfo } from '../server/images.ts';
import { cloudUserData } from '../server/seed.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ARM64 instances require a matching Debian image, UEFI and TCG-compatible acceleration
 * 协作入口 / Collaborators: `assert.equal`, `createSchema.parse`, `assert.match`, `distroInfo`.
 * 检查边界 / Checked boundaries: `assert.equal(createSchema.parse(config).architecture, 'aarch64')`; `assert.match(distroInfo('debian', 'aarch64').file, /debian-12-arm64\.qcow2$/)`.
 */
test('ARM64 instances require a matching Debian image, UEFI and TCG-compatible acceleration', () => {
  const config = { name: 'arm-test', distro: 'debian', architecture: 'aarch64',
    firmware: 'uefi', accelerator: 'tcg' } as const;
  assert.equal(createSchema.parse(config).architecture, 'aarch64');
  assert.match(distroInfo('debian', 'aarch64').file, /debian-12-arm64\.qcow2$/);
  assert.throws(() => createSchema.parse({ ...config, firmware: 'bios' }));
  assert.throws(() => createSchema.parse({ ...config, distro: 'alpine' }));
  assert.throws(() => createSchema.parse({ ...config, accelerator: 'whpx' }));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ARM64 cloud-init writes the readiness marker to the PL011 serial device
 * 协作入口 / Collaborators: `assert.match`, `cloudUserData`.
 * 检查边界 / Checked boundaries: `assert.match(cloudUserData('arm-test', 'ssh-rsa example', '/dev/ttyAMA0'), /SAKURA_READY.*\/dev\/ttyAMA0/)`; `assert.match(cloudUserData('x86-test', 'ssh-rsa example'), /SAKURA_READY.*\/dev\/ttyS0/)`.
 */
test('ARM64 cloud-init writes the readiness marker to the PL011 serial device', () => {
  assert.match(cloudUserData('arm-test', 'ssh-rsa example', '/dev/ttyAMA0'),
    /SAKURA_READY.*\/dev\/ttyAMA0/);
  assert.match(cloudUserData('x86-test', 'ssh-rsa example'), /SAKURA_READY.*\/dev\/ttyS0/);
});
