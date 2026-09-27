import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-online-snapshot-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-online-snapshot-'));
await mkdir(join(directory, 'images'), { recursive: true });
await copyFile(resolve('.data/images/alpine-3.23.qcow2'), join(directory, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const machines = new Machines(await createRuntime());
await machines.init();

async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(250);
  }
}

try {
  const vm = await machines.create({ name: 'online-snapshot-smoke', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  console.log('Booting isolated Alpine/QEMU guest');
  await boot(vm.id);
  const installed = await machines.exec(vm.id,
    'apk add --no-cache qemu-guest-agent util-linux && rc-service qemu-guest-agent start', 300000);
  assert.equal(installed.code, 0, installed.stdout + installed.stderr);
  const prepared = await machines.exec(vm.id,
    'printf before > /workspace/online-snapshot.txt; sync; mount | grep " on / "', 30000);
  assert.equal(prepared.code, 0, prepared.stdout + prepared.stderr);
  const snapshot = await machines.onlineSnapshot(vm.id, 'online-baseline');
  assert.equal(snapshot.consistency, 'filesystem');
  assert.equal(machines.state(vm.id), 'running');
  const changed = await machines.exec(vm.id,
    'printf after > /workspace/online-snapshot.txt; sync; cat /workspace/online-snapshot.txt');
  assert.equal(changed.code, 0, changed.stdout + changed.stderr);
  assert.equal(changed.stdout.trim(), 'after');
  await machines.stop(vm.id);
  await machines.restore(vm.id, snapshot.id);
  await boot(vm.id);
  const restored = await machines.exec(vm.id, 'cat /workspace/online-snapshot.txt');
  assert.equal(restored.code, 0, restored.stdout + restored.stderr);
  assert.equal(restored.stdout.trim(), 'before');
  console.log('PASS online filesystem freeze, QMP snapshot, thaw, stopped restore and guest reboot');
} finally {
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
