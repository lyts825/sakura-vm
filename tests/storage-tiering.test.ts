/**
 * 模块职责：回归验证模块，围绕 `storage-tiering` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `storage-tiering`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: hot/cold policy previews, moves and periodically rebalances only stopped instances.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-tiering-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
process.env.SAKURA_DATA_DIR = join(root, 'data');
const { Machines } = await import('../server/machines.ts');
const { StorageTiering } = await import('../server/storage-tiering.ts');
const engine = { runtime: { /**
 * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
 * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 */
close: async () => {} } } as unknown as Engine;
after(async () => { await rm(root, { recursive: true, force: true }); });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: hot/cold policy previews, moves and periodically rebalances only stopped instances
 * 状态影响 / State effects: `machines.get(vm.id).lastUsedAt`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `mkdir`, `writeFile`, `machines.init`.
 * 检查边界 / Checked boundaries: `assert.rejects(tiering.run(vm.id, { ...policy, coldPoolId: 'default' }, 'run'), /热池与冷池必须不同/)`; `assert.equal(preview.current?.targetPoolId, pool.id)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('hot/cold policy previews, moves and periodically rebalances only stopped instances', async () => {
  const external = join(root, 'cold');
  await mkdir(external);
  const disk = join(root, 'source.qcow2');
  await writeFile(disk, 'tiering-disk-proof');
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const pool = await machines.storagePools.create('cold-hdd', external);
  const vm = await machines.adopt({ name: 'tiered' }, disk, 'key', Buffer.from('seed'));
  const tiering = new StorageTiering(machines);
  await tiering.init();
  const policy = { mode: 'save', enabled: false, hotPoolId: 'default',
    coldPoolId: pool.id, idleHours: 24, intervalHours: 1 };
  await assert.rejects(tiering.run(vm.id,
    { ...policy, coldPoolId: 'default' }, 'run'), /热池与冷池必须不同/);
  await tiering.run(vm.id, policy, 'run');

  machines.get(vm.id).lastUsedAt = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const preview = await tiering.run(vm.id, { mode: 'status' }, 'check');
  assert.equal(preview.current?.targetPoolId, pool.id);
  assert.equal(preview.current?.ready, true);
  const moved = await tiering.run(vm.id, { mode: 'apply' }, 'run');
  assert.ok('applied' in moved);
  assert.equal(moved.applied.moved, true);
  assert.equal(machines.get(vm.id).storagePoolId, pool.id);
  assert.equal(await readFile(join(external, 'sakura-machines', vm.id, 'disk.qcow2'),
    'utf8'), 'tiering-disk-proof');

  machines.get(vm.id).lastUsedAt = new Date().toISOString();
  const hot = await tiering.run(vm.id, { mode: 'apply' }, 'run');
  assert.ok('applied' in hot);
  assert.equal(hot.applied.moved, true);
  assert.equal(machines.get(vm.id).storagePoolId, undefined);
  assert.equal((await tiering.view(vm.id)).history.length, 2);
  await tiering.close();

  const reopened = new StorageTiering(machines);
  assert.equal((await reopened.view(vm.id)).policy?.coldPoolId, pool.id);
  await reopened.run(vm.id, { ...policy, enabled: true }, 'run');
  machines.get(vm.id).lastUsedAt = new Date(Date.now() - 48 * 3_600_000).toISOString();
  machines.live.set(vm.id, {} as never);
  assert.match((await reopened.view(vm.id)).current?.reason || '', /仍在运行/);
  await reopened.tick();
  assert.equal(machines.get(vm.id).storagePoolId, undefined);
  machines.live.delete(vm.id);
  await reopened.tick();
  assert.equal(machines.get(vm.id).storagePoolId, pool.id);
  assert.equal((await reopened.view(vm.id)).history.length, 3);
  await reopened.close();
  await machines.delete(vm.id);
  await machines.storagePools.remove(pool.id);
  await machines.close();
});
