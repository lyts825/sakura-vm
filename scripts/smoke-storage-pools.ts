import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = await mkdtemp(join(tmpdir(), 'sakura-pool-smoke-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
const external = join(root, 'external');
await mkdir(external);
process.env.SAKURA_DATA_DIR = join(root, 'data');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { StorageTiering } = await import('../server/storage-tiering.ts');
const machines = new Machines(await createRuntime());
const tiering = new StorageTiering(machines);

async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 300_000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id) || '客户机启动超时');
    await delay(300);
  }
}

try {
  await machines.init();
  await tiering.init();
  const pool = await machines.storagePools.create('pool-smoke', external);
  const vm = await machines.create({ name: 'pool-smoke', storagePoolId: pool.id });
  const pooledDisk = join(external, 'sakura-machines', vm.id, 'disk.qcow2');
  assert.ok((await stat(pooledDisk)).size > 0);
  await boot(vm.id);
  await machines.writeGuestFile(vm.id, '/workspace/pool-proof.txt', 'persistent-pool-proof', false);
  await machines.stop(vm.id, false);
  assert.ok(Date.parse(machines.get(vm.id).lastUsedAt || '') > 0);

  const toDefault = await machines.moveStoragePool(vm.id, 'default');
  assert.equal(toDefault.cleanupPending, false);
  assert.ok((await stat(join(process.env.SAKURA_DATA_DIR!, 'machines', vm.id,
    'disk.qcow2'))).size > 0);
  await assert.rejects(stat(pooledDisk), { code: 'ENOENT' });
  await boot(vm.id);
  assert.equal(await machines.readGuestFile(vm.id, '/workspace/pool-proof.txt'),
    'persistent-pool-proof');
  await machines.stop(vm.id, false);

  await tiering.run(vm.id, { mode: 'save', enabled: false, hotPoolId: pool.id,
    coldPoolId: 'default', idleHours: 24, intervalHours: 1 }, 'run');
  const decision = await tiering.run(vm.id, { mode: 'status' }, 'check');
  assert.equal(decision.current?.targetPoolId, pool.id);
  const toExternal = await tiering.run(vm.id, { mode: 'apply' }, 'run');
  assert.ok('applied' in toExternal);
  assert.equal(toExternal.applied.moved, true);
  assert.ok((await stat(pooledDisk)).size > 0);
  await boot(vm.id);
  assert.equal(await machines.readGuestFile(vm.id, '/workspace/pool-proof.txt'),
    'persistent-pool-proof');
  await machines.stop(vm.id, false);
  await machines.delete(vm.id);
  await machines.storagePools.remove(pool.id);
  assert.deepEqual((await machines.storagePools.view()).pools.map((item) => item.id),
    ['default']);
  console.log('External pool allocation, tiering move and three real guest boots passed.');
} finally {
  await tiering.close();
  await machines.close();
  await rm(root, { recursive: true, force: true });
}
