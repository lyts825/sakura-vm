/**
 * 模块职责：回归验证模块，围绕 `disk-encryption-recovery` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `disk-encryption-recovery`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: startup finalizes published encryption and rolls back an uncommitted conversion.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-disk-recovery-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-disk-recovery-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: startup finalizes published encryption and rolls back an uncommitted conversion
 * 协作入口 / Collaborators: `randomUUID`, `createSchema.parse`, `new Date().toISOString`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.equal(machines.get(encrypted).diskEncryption?.secretName, 'DiskPassphrase')`; `assert.equal(machines.get(plain).diskEncryption, undefined)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('startup finalizes published encryption and rolls back an uncommitted conversion', async () => {
  const encrypted = randomUUID(), plain = randomUUID();
  const records = [
    { ...createSchema.parse({ name: 'encrypted' }), id: encrypted,
      createdAt: new Date().toISOString(), snapshots: [] },
    { ...createSchema.parse({ name: 'plain' }), id: plain,
      createdAt: new Date().toISOString(), snapshots: [] },
  ];
  for (const id of [encrypted, plain]) {
    await mkdir(vmDir(id), { recursive: true });
    await writeFile(join(vmDir(id), 'disk.qcow2'), 'disk');
    await writeFile(join(vmDir(id), '.disk.encrypting.qcow2'), 'interrupted');
    await writeFile(join(vmDir(id), '.disk.before-encrypt.qcow2'), 'previous');
    await writeFile(join(vmDir(id), '.disk-encryption.pending.json'),
      JSON.stringify({ format: 'luks', secretName: 'DiskPassphrase' }));
  }
  await writeFile(join(root, 'machines.json'), JSON.stringify(records));
  const engine = { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _name: string; args: string[]。
   * 结果：返回分支计算值（`JSON.stringify({ format: 'qcow2', encrypted: args.at(-1)?.includes(encrypted) })`），以 Promise 交付。
   * Result: Return the branch-computed value (`JSON.stringify({ format: 'qcow2', encrypted: args.at(-1)?.includes(encrypted) })`) through a Promise.
   * 验证场景 / Scenario: startup finalizes published encryption and rolls back an uncommitted conversion
   * 协作入口 / Collaborators: `JSON.stringify`, `args.at(-1)?.includes`, `args.at`.
   */
  run: async (_name: string, args: string[]) => JSON.stringify({
    format: 'qcow2', encrypted: args.at(-1)?.includes(encrypted) }),
    runtime: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: startup finalizes published encryption and rolls back an uncommitted conversion
     */
    close: async () => {} } } as unknown as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  try {
    assert.equal(machines.get(encrypted).diskEncryption?.secretName, 'DiskPassphrase');
    assert.equal(machines.get(plain).diskEncryption, undefined);
    const persisted = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
    assert.equal(persisted.length, 2);
    assert.equal(persisted[0].diskEncryption.secretName, 'DiskPassphrase');
    for (const id of [encrypted, plain])
      for (const file of ['.disk.encrypting.qcow2', '.disk.before-encrypt.qcow2',
        '.disk-encryption.pending.json'])
        await assert.rejects(readFile(join(vmDir(id), file)), { code: 'ENOENT' });
  } finally { await machines.close(); }
  const mismatch = new Machines({ ...engine,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`JSON.stringify({ format: 'qcow2', encrypted: false })`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.stringify({ format: 'qcow2', encrypted: false })`) through a Promise.
     * 验证场景 / Scenario: startup finalizes published encryption and rolls back an uncommitted conversion
     * 协作入口 / Collaborators: `JSON.stringify`.
     */
    run: async () => JSON.stringify({ format: 'qcow2', encrypted: false }) } as Engine, fakeVmNetwork);
  await assert.rejects(mismatch.init(), /加密标记与磁盘格式不一致/);
  await mismatch.close();
});
