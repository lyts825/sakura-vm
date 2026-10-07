/**
 * 模块职责：回归验证模块，围绕 `firmware` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `firmware`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: UEFI support requires both regular OVMF files and preserves each instance NVRAM; VM configuration accepts BIOS or UEFI but rejects unknown firmware.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'sakura-firmware-'));
assert.equal(dirname(root), resolve(tmpdir()));
assert.ok(basename(root).startsWith('sakura-firmware-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_QEMU_DIR = join(root, 'qemu');
const { firmwareSupport, ensureUefiFirmware, requireUefiSupport } = await import('../server/firmware.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: UEFI support requires both regular OVMF files and preserves each instance NVRAM
 * 协作入口 / Collaborators: `assert.equal`, `firmwareSupport`, `assert.rejects`, `requireUefiSupport`.
 * 检查边界 / Checked boundaries: `assert.equal((await firmwareSupport()).available, false)`; `assert.rejects(requireUefiSupport(), /OVMF/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('UEFI support requires both regular OVMF files and preserves each instance NVRAM', async () => {
  assert.equal((await firmwareSupport()).available, false);
  await assert.rejects(requireUefiSupport(), /OVMF/);
  const share = join(root, 'qemu', 'share');
  await mkdir(share, { recursive: true });
  const code = join(share, 'edk2-x86_64-code.fd');
  const template = join(share, 'edk2-i386-vars.fd');
  await writeFile(code, Buffer.alloc(65536, 1));
  await writeFile(template, Buffer.alloc(65536, 2));
  assert.equal((await firmwareSupport()).available, true);
  const id = randomUUID();
  await mkdir(vmDir(id), { recursive: true });
  const paths = await ensureUefiFirmware(id);
  assert.equal(paths.code, code);
  assert.equal((await readFile(paths.vars))[0], 2);
  const changed = Buffer.alloc(65536, 3);
  await writeFile(paths.vars, changed);
  await ensureUefiFirmware(id);
  assert.deepEqual(await readFile(paths.vars), changed);
  await writeFile(paths.vars, 'invalid');
  await assert.rejects(ensureUefiFirmware(id), /NVRAM 文件无效/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM configuration accepts BIOS or UEFI but rejects unknown firmware
 * 协作入口 / Collaborators: `assert.equal`, `createSchema.parse`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(createSchema.parse({ name: 'uefi-test', firmware: 'uefi' }).firmware, 'uefi')`; `assert.equal(createSchema.parse({ name: 'bios-test' }).firmware, undefined)`.
 */
test('VM configuration accepts BIOS or UEFI but rejects unknown firmware', () => {
  assert.equal(createSchema.parse({ name: 'uefi-test', firmware: 'uefi' }).firmware, 'uefi');
  assert.equal(createSchema.parse({ name: 'bios-test' }).firmware, undefined);
  assert.throws(() => createSchema.parse({ name: 'unknown-test', firmware: 'other' }));
});
