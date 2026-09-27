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
const engine = { runtime: { close: async () => {} } } as unknown as Engine;
after(async () => { await rm(root, { recursive: true, force: true }); });

test('hot/cold policy previews, moves and periodically rebalances only stopped instances', async () => {
  const external = join(root, 'cold');
  await mkdir(external);
  const disk = join(root, 'source.qcow2');
  await writeFile(disk, 'tiering-disk-proof');
  const machines = new Machines(engine);
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
