/**
 * 模块职责：回归验证模块，围绕 `trusted-boot-snapshots` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `trusted-boot-snapshots`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: stopped snapshots keep TPM and NVRAM with their disk and reject damaged or legacy state; online disk snapshots reject active TPM state before freezing the guest.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-trusted-snapshots-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { TrustedBootService } = await import('../server/trusted-boot-service.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-trusted-snapshots-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stopped snapshots keep TPM and NVRAM with their disk and reject damaged or legacy state
 * 状态影响 / State effects: `archive.files[0].sha256`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `machines.records.set`, `createSchema.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(original?.enabled, true)`; `assert.deepEqual(original?.files.map((file) => file.name), ['uefi-secure-vars.fd', 'tpm2/tpm2-00.permall'])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('stopped snapshots keep TPM and NVRAM with their disk and reject damaged or legacy state', async (t) => {
  const commands: string[][] = [];
  const machines = new Machines({ runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: stopped snapshots keep TPM and NVRAM with their disk and reject damaged or legacy state
   */
  close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool; args。
     * 结果：返回分支计算值（`''`），以 Promise 交付。
     * Result: Return the branch-computed value (`''`) through a Promise.
     * 验证场景 / Scenario: stopped snapshots keep TPM and NVRAM with their disk and reject damaged or legacy state
     * 协作入口 / Collaborators: `commands.push`.
     */
    run: async (_tool, args) => { commands.push(args); return ''; } } as Engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, { ...createSchema.parse({ name: 'trusted-snapshot',
    distro: 'debian', firmware: 'uefi' }), id,
    createdAt: new Date().toISOString(), snapshots: [] });
  const directory = vmDir(id);
  await mkdir(join(directory, 'tpm2'), { recursive: true });
  await writeFile(join(directory, 'id_rsa'), 'controller');
  await writeFile(join(directory, 'seed.iso'), 'seed');
  await writeFile(join(directory, 'uefi-secure-vars.fd'), 'original-vars');
  await writeFile(join(directory, 'tpm2', 'tpm2-00.permall'), 'original-tpm');
  await writeFile(join(root, 'trusted-boot.json'), JSON.stringify({ [id]: { enabled: true } }));
  const service = new TrustedBootService(machines);
  await service.init();
  t.after(async () => { await service.close(); await machines.close(); });

  const shot = await machines.snapshot(id, 'trusted state');
  const original = await service.capture(id, shot.id);
  assert.equal(original?.enabled, true);
  assert.deepEqual(original?.files.map((file) => file.name),
    ['uefi-secure-vars.fd', 'tpm2/tpm2-00.permall']);
  await writeFile(join(directory, 'uefi-secure-vars.fd'), 'changed-vars');
  await writeFile(join(directory, 'tpm2', 'tpm2-00.permall'), 'changed-tpm');
  await writeFile(join(directory, 'tpm2', 'extra'), 'new-state');
  await machines.restore(id, shot.id);
  assert.deepEqual(await service.capture(id), original);
  await assert.rejects(readFile(join(directory, 'tpm2', 'extra')), { code: 'ENOENT' });

  const second = await machines.snapshot(id, 'tamper-check');
  const sidecar = join(directory, `.snapshot-${second.id}.trusted-boot.json`);
  const archive = JSON.parse(await readFile(sidecar, 'utf8'));
  archive.files[0].sha256 = '0'.repeat(64);
  await writeFile(sidecar, JSON.stringify(archive));
  const appliedBefore = commands.filter((args) => args.includes('-a')).length;
  await assert.rejects(machines.restore(id, second.id), /校验失败/);
  assert.equal(commands.filter((args) => args.includes('-a')).length, appliedBefore);

  const legacy = { id: randomUUID(), name: 'legacy', createdAt: new Date().toISOString() };
  machines.get(id).snapshots.push(legacy);
  await assert.rejects(service.capture(id, legacy.id), /没有对应的 TPM\/NVRAM 状态/);
  await assert.rejects(machines.restore(id, legacy.id), /没有对应的 TPM\/NVRAM 状态/);

  await machines.editSnapshot(id, shot.id, null);
  await assert.rejects(readFile(join(directory, `.snapshot-${shot.id}.trusted-boot.json`)),
    { code: 'ENOENT' });

  await service.action(id, { operation: 'configure', policy: { enabled: false } });
  await rm(join(directory, 'uefi-secure-vars.fd'));
  await rm(join(directory, 'tpm2'), { recursive: true });
  const plain = await machines.snapshot(id, 'before trusted boot');
  await mkdir(join(directory, 'tpm2'));
  await writeFile(join(directory, 'uefi-secure-vars.fd'), 'later-vars');
  await writeFile(join(directory, 'tpm2', 'later'), 'later-tpm');
  await machines.restore(id, plain.id);
  assert.equal(await service.capture(id), undefined);
  await assert.rejects(readFile(join(directory, 'uefi-secure-vars.fd')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(directory, 'tpm2', 'later')), { code: 'ENOENT' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: online disk snapshots reject active TPM state before freezing the guest
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `machines.records.set`, `createSchema.parse`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.onlineSnapshot(id, 'unsafe'), /需要停机快照/)`; `assert.equal(machines.get(id).snapshots.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('online disk snapshots reject active TPM state before freezing the guest', async (t) => {
  const machines = new Machines({ runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: online disk snapshots reject active TPM state before freezing the guest
   */
  close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool; _args。
     * 结果：返回分支计算值（`''`），以 Promise 交付。
     * Result: Return the branch-computed value (`''`) through a Promise.
     * 验证场景 / Scenario: online disk snapshots reject active TPM state before freezing the guest
     */
    run: async (_tool, _args) => '' } as Engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, { ...createSchema.parse({ name: 'online-trusted',
    distro: 'debian', firmware: 'uefi' }), id,
    createdAt: new Date().toISOString(), snapshots: [] });
  const directory = vmDir(id);
  await mkdir(directory);
  await writeFile(join(directory, 'uefi-secure-vars.fd'), 'vars');
  const service = new TrustedBootService(machines);
  await service.init();
  t.after(async () => { machines.live.delete(id); await service.close(); await machines.close(); });
  machines.live.set(id, { status: 'running' } as any);
  await assert.rejects(machines.onlineSnapshot(id, 'unsafe'), /需要停机快照/);
  assert.equal(machines.get(id).snapshots.length, 0);
});
