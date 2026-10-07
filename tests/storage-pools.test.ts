/**
 * 模块职责：回归验证模块，围绕 `storage-pools` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `storage-pools`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: pool assignment, verified moves and cleanup survive a controller restart; a tampered ownership marker disables the external pool.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Engine } from '../server/runtime.ts';
import { hostRuntime } from '../server/host-runtime/index.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-pools-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
process.env.SAKURA_DATA_DIR = join(root, 'data');
const { Machines } = await import('../server/machines.ts');
const { DataMigration } = await import('../server/data-migration.ts');
const { vmDir } = await import('../server/model.ts');
const engine = { runtime: { /**
 * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
 * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 */
close: async () => {} } } as unknown as Engine;
after(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pool assignment, verified moves and cleanup survive a controller restart
 * 状态影响 / State effects: `machines`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `mkdir`, `Buffer.from`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.equal(vmDir(vm.id), externalDir)`; `assert.deepEqual(await readFile(join(externalDir, 'disk.qcow2')), disk)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('pool assignment, verified moves and cleanup survive a controller restart', async () => {
  const external = join(root, 'external');
  await mkdir(external);
  const source = join(root, 'source.qcow2');
  const disk = Buffer.from('qcow2-storage-pool-proof');
  await writeFile(source, disk);
  let machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const pool = await machines.storagePools.create('fast-disk', external);
  const vm = await machines.adopt(
    { name: 'pooled', storagePoolId: pool.id },
    source,
    'test-key',
    Buffer.from('test-seed'),
    { enabled: true },
  );
  const externalDir = join(external, 'sakura-machines', vm.id);
  assert.equal(vmDir(vm.id), externalDir);
  assert.deepEqual(await readFile(join(externalDir, 'disk.qcow2')), disk);
  assert.equal((await machines.storagePools.view(vm.id)).pools[1].allocatedBytes, disk.length);
  const migration = new DataMigration(machines, () => []);
  await assert.rejects(migration.plan(join(root, 'new-data')), /迁回默认池/);
  await assert.rejects(machines.storagePools.remove(pool.id), /仍有实例/);
  await assert.rejects(machines.storagePools.create('nested', join(external, 'sakura-machines')), /重叠/);
  await assert.rejects(machines.storagePools.create('data', process.env.SAKURA_DATA_DIR!), /数据目录重叠/);

  const defaultDir = machines.storagePools.directory(vm.id, 'default');
  await mkdir(defaultDir);
  await assert.rejects(machines.moveStoragePool(vm.id, 'default'), /已有同标识目录/);
  assert.equal(vmDir(vm.id), externalDir);
  await rm(defaultDir, { recursive: true });
  const moved = await machines.moveStoragePool(vm.id, 'default');
  assert.equal(moved.moved, true);
  assert.equal(moved.cleanupPending, false);
  assert.equal(vmDir(vm.id), defaultDir);
  assert.deepEqual(await readFile(join(defaultDir, 'disk.qcow2')), disk);
  await assert.rejects(stat(externalDir), { code: 'ENOENT' });
  await assert.rejects(migration.plan(join(external, 'new-data')), /已注册存储池/);
  await migration.close();
  await machines.close();

  machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  assert.equal(vmDir(vm.id), defaultDir);
  assert.equal((await machines.storagePools.view(vm.id)).currentPoolId, 'default');
  await cp(defaultDir, externalDir, { recursive: true });
  await machines.storagePools.registerCleanup(vm.id, pool.id, 'default');
  await assert.rejects(machines.delete(vm.id), /先清理存储池/);
  const cleanup = await machines.storagePools.cleanup();
  assert.deepEqual(cleanup, { completed: [vm.id], errors: [] });
  await assert.rejects(stat(externalDir), { code: 'ENOENT' });

  const back = await machines.moveStoragePool(vm.id, pool.id);
  assert.equal(back.moved, true);
  assert.equal(vmDir(vm.id), externalDir);
  assert.deepEqual(await readFile(join(externalDir, 'disk.qcow2')), disk);
  await machines.delete(vm.id);
  await machines.storagePools.remove(pool.id);
  assert.equal((await machines.storagePools.view()).pools.length, 1);
  await machines.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a tampered ownership marker disables the external pool
 * 协作入口 / Collaborators: `join`, `mkdir`, `machines.init`, `machines.storagePools.create`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.storagePools.ensure(pool.id), /标记不匹配/)`; `assert.equal( (await machines.storagePools.view()).pools.find((item) => item.id === pool.id)?.available, false, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a tampered ownership marker disables the external pool', async () => {
  const external = join(root, 'tampered');
  await mkdir(external);
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const pool = await machines.storagePools.create('tamper-check', external);
  const marker = join(external, 'sakura-machines', '.sakura-pool.json');
  await writeFile(marker, JSON.stringify({ id: 'ffffffffffffffff' }));
  await assert.rejects(machines.storagePools.ensure(pool.id), /标记不匹配/);
  assert.equal(
    (await machines.storagePools.view()).pools.find((item) => item.id === pool.id)?.available,
    false,
  );
  await writeFile(marker, JSON.stringify({ id: pool.id }));
  await machines.storagePools.remove(pool.id);
  await machines.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a failed cleanup receipt keeps its original admission until the existing pool recovery confirms deletion
 * 状态影响 / State effects: `machines.storagePools.clearCleanup`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `mkdir`, `writeFile`, `machines.init`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.moveStoragePool(vm.id, pool.id), { code: 'STORAGE_CLEANUP_PENDING' })`; `assert.equal(held?.state, 'cleanup-pending')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a failed cleanup receipt keeps its original admission until the existing pool recovery confirms deletion', async () => {
  const external = join(root, 'cleanup-receipt'),
    source = join(root, 'cleanup-source');
  await mkdir(external);
  await writeFile(source, 'disk');
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const pool = await machines.storagePools.create('cleanup-proof', external);
  const vm = await machines.adopt({ name: 'cleanup-proof' }, source, 'key', Buffer.from('seed'));
  const clear = machines.storagePools.clearCleanup.bind(machines.storagePools);
  machines.storagePools.clearCleanup = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a failed cleanup receipt keeps its original admission until the existing pool recovery confirms deletion
   * 失败 / Failure: `new Error('simulated metadata flush failure')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => {
    throw new Error('simulated metadata flush failure');
  };
  try {
    await assert.rejects(machines.moveStoragePool(vm.id, pool.id), { code: 'STORAGE_CLEANUP_PENDING' });
    const held = hostRuntime.snapshot().resources.find((item) => item.owner === 'core:storage-pool-move');
    assert.equal(held?.state, 'cleanup-pending');
    assert.equal(machines.storagePools.hasPendingCleanup(vm.id), true);
    assert.equal(await readFile(join(vmDir(vm.id), 'disk.qcow2'), 'utf8'), 'disk');
    machines.storagePools.clearCleanup = clear;
    assert.deepEqual(await machines.storagePools.cleanup(), { completed: [vm.id], errors: [] });
    assert.equal(
      hostRuntime.snapshot().resources.some((item) => item.id === held!.id),
      false,
    );
    await machines.delete(vm.id);
    await machines.storagePools.remove(pool.id);
  } finally {
    machines.storagePools.clearCleanup = clear;
    await machines.close();
  }
});
