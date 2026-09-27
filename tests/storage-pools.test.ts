import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-pools-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
process.env.SAKURA_DATA_DIR = join(root, 'data');
const { Machines } = await import('../server/machines.ts');
const { DataMigration } = await import('../server/data-migration.ts');
const { vmDir } = await import('../server/model.ts');
const engine = { runtime: { close: async () => {} } } as unknown as Engine;
after(async () => { await rm(root, { recursive: true, force: true }); });

test('pool assignment, verified moves and cleanup survive a controller restart', async () => {
  const external = join(root, 'external');
  await mkdir(external);
  const source = join(root, 'source.qcow2');
  const disk = Buffer.from('qcow2-storage-pool-proof');
  await writeFile(source, disk);
  let machines = new Machines(engine);
  await machines.init();
  const pool = await machines.storagePools.create('fast-disk', external);
  const vm = await machines.adopt({ name: 'pooled', storagePoolId: pool.id },
    source, 'test-key', Buffer.from('test-seed'), { enabled: true });
  const externalDir = join(external, 'sakura-machines', vm.id);
  assert.equal(vmDir(vm.id), externalDir);
  assert.deepEqual(await readFile(join(externalDir, 'disk.qcow2')), disk);
  assert.equal((await machines.storagePools.view(vm.id)).pools[1].allocatedBytes, disk.length);
  const migration = new DataMigration(machines, () => []);
  await assert.rejects(migration.plan(join(root, 'new-data')), /迁回默认池/);
  await assert.rejects(machines.storagePools.remove(pool.id), /仍有实例/);
  await assert.rejects(machines.storagePools.create('nested', join(external, 'sakura-machines')),
    /重叠/);
  await assert.rejects(machines.storagePools.create('data', process.env.SAKURA_DATA_DIR!),
    /数据目录重叠/);

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

  machines = new Machines(engine);
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

test('a tampered ownership marker disables the external pool', async () => {
  const external = join(root, 'tampered');
  await mkdir(external);
  const machines = new Machines(engine);
  await machines.init();
  const pool = await machines.storagePools.create('tamper-check', external);
  const marker = join(external, 'sakura-machines', '.sakura-pool.json');
  await writeFile(marker, JSON.stringify({ id: 'ffffffffffffffff' }));
  await assert.rejects(machines.storagePools.ensure(pool.id), /标记不匹配/);
  assert.equal((await machines.storagePools.view()).pools.find((item) => item.id === pool.id)?.available,
    false);
  await writeFile(marker, JSON.stringify({ id: pool.id }));
  await machines.storagePools.remove(pool.id);
  await machines.close();
});
