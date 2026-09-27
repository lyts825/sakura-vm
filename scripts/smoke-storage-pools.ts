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
const machines = new Machines(await createRuntime());

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
  const pool = await machines.storagePools.create('pool-smoke', external);
  const vm = await machines.create({ name: 'pool-smoke', storagePoolId: pool.id });
  const pooledDisk = join(external, 'sakura-machines', vm.id, 'disk.qcow2');
  assert.ok((await stat(pooledDisk)).size > 0);
  await boot(vm.id);
  await machines.writeGuestFile(vm.id, '/workspace/pool-proof.txt', 'persistent-pool-proof', false);
  await machines.stop(vm.id, false);

  const toDefault = await machines.moveStoragePool(vm.id, 'default');
  assert.equal(toDefault.cleanupPending, false);
  assert.ok((await stat(join(process.env.SAKURA_DATA_DIR!, 'machines', vm.id,
    'disk.qcow2'))).size > 0);
  await assert.rejects(stat(pooledDisk), { code: 'ENOENT' });
  await boot(vm.id);
  assert.equal(await machines.readGuestFile(vm.id, '/workspace/pool-proof.txt'),
    'persistent-pool-proof');
  await machines.stop(vm.id, false);

  const toExternal = await machines.moveStoragePool(vm.id, pool.id);
  assert.equal(toExternal.cleanupPending, false);
  assert.ok((await stat(pooledDisk)).size > 0);
  await boot(vm.id);
  assert.equal(await machines.readGuestFile(vm.id, '/workspace/pool-proof.txt'),
    'persistent-pool-proof');
  await machines.stop(vm.id, false);
  await machines.delete(vm.id);
  await machines.storagePools.remove(pool.id);
  assert.deepEqual((await machines.storagePools.view()).pools.map((item) => item.id),
    ['default']);
  console.log('External pool allocation, both moves and three real guest boots passed.');
} finally {
  await machines.close();
  await rm(root, { recursive: true, force: true });
}
