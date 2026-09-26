import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';

const directory = await mkdtemp(join(tmpdir(), 'sakura-storage-vm-'));
await mkdir(join(directory, 'images'));
await copyFile(resolve('.data/images/alpine-3.23.qcow2'), join(directory, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const { backupBlocks } = await import('../server/backup-blocks.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const features = await Features.create(machines, ['backups', 'maintenance']);
async function boot(id: string) {
  await machines.start(id);
  const until = Date.now() + 300000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > until || ['stopped', 'error'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(300);
  }
}
async function done(id: string) {
  await features.backups.jobs.wait(id);
  const job = features.backups.jobs.view(id)!;
  assert.equal(job.status, 'done', job.error + '\n' + job.log);
}
try {
  const vm = await machines.create({
    name: 'storage-source',
    cpus: 2,
    memoryMiB: 1024,
    diskGiB: 4,
    hardware: {
      cpu: {
        sockets: 2,
        cores: 1,
        threads: 1,
        numa: [
          { memoryMiB: 512, cpus: [0] },
          { memoryMiB: 512, cpus: [1] },
        ],
      },
      devices: { networkCard: 'e1000', discard: true },
      ipv6: true,
    },
  });
  console.log('Booting isolated NUMA / e1000 / IPv6 guest');
  await boot(vm.id);
  const topology = await machines.exec(
    vm.id,
    "ls -d /sys/devices/system/node/node[0-9]*; grep -c '^processor' /proc/cpuinfo; ip -6 addr show eth0",
  );
  assert.equal(topology.code, 0, topology.stderr);
  assert.match(topology.stdout, /node1/);
  assert.match(topology.stdout, /inet6/);
  await machines.writeGuestFile(vm.id, '/workspace/storage-proof.txt', 'deduplicated restore proof', false);
  const prepare = await machines.exec(
    vm.id,
    'set -eu\ncommand -v fstrim >/dev/null || apk add --no-cache util-linux\ndd if=/dev/urandom of=/workspace/trim-test bs=1048576 count=16\nsync\nrm /workspace/trim-test',
    180000,
  );
  assert.equal(prepare.code, 0, prepare.stderr);
  await features.maintenance.diskPolicy(vm.id, {
    enabled: true,
    mode: 'both',
    intervalHours: 24,
    compress: true,
  });
  await features.maintenance.tick();
  await features.maintenance.jobs.wait(vm.id);
  const trim = features.maintenance.jobs.view(vm.id)!;
  assert.equal(trim.status, 'done', trim.error + '\n' + trim.log);
  assert.ok((await features.maintenance.diskView(vm.id)).successes.trim);
  console.log('Scheduled TRIM passed on the running root filesystem');
  await machines.stop(vm.id, false);
  await features.maintenance.tick();
  await features.maintenance.jobs.wait(vm.id);
  const compact = features.maintenance.jobs.view(vm.id)!;
  assert.equal(compact.status, 'done', compact.error + '\n' + compact.log);
  assert.ok((await features.maintenance.diskView(vm.id)).successes.compact);
  await features.maintenance.diskPolicy(vm.id, { enabled: false });
  console.log('Scheduled offline compression passed QCOW2 check and full disk comparison');
  console.log('Creating two real block-deduplicated disk backups');
  await features.backups.policy(vm.id, { deduplicate: true });
  for (let i = 0; i < 2; i++) {
    await features.backups.run(vm.id);
    await done(vm.id);
  }
  const backups = (await features.backups.view(vm.id)).items;
  assert.equal(backups.length, 2);
  assert.ok(backups.every((entry) => entry.storage === 'blocks'));
  const stats = await backupBlocks().inspect();
  assert.ok(stats.savedBytes > 0, JSON.stringify(stats));
  console.log('Shared backup bytes:', stats.savedBytes);
  const source = await features.backups.downloadable(vm.id, backups[0].id);
  assert.equal(source.type, 'stream');
  const hash = createHash('sha256');
  let size = 0;
  await source.write(
    new Writable({
      write(chunk, _encoding, cb) {
        hash.update(chunk);
        size += chunk.length;
        cb();
      },
    }),
    new AbortController().signal,
  );
  assert.equal(hash.digest('hex'), backups[0].checksum);
  assert.equal(size, backups[0].bytes);
  await features.backups.operate(vm.id, backups[0].id, 'restore', 'storage-restored');
  await done(vm.id);
  const restored = [...machines.records.values()].find((entry) => entry.name === 'storage-restored')!;
  assert.deepEqual(restored.hardware, machines.get(vm.id).hardware);
  await boot(restored.id);
  assert.equal(
    await machines.readGuestFile(restored.id, '/workspace/storage-proof.txt'),
    'deduplicated restore proof',
  );
  console.log('Restored disk boots with original hardware and verified project file');
  for (const entry of backups) await features.backups.operate(vm.id, entry.id, 'delete');
  assert.equal((await backupBlocks().inspect(true)).physicalBytes, 0);
  assert.equal(
    await machines.readGuestFile(restored.id, '/workspace/storage-proof.txt'),
    'deduplicated restore proof',
  );
  console.log('Garbage collection releases unreferenced blocks without affecting the restored VM');
} finally {
  await features.close();
  await machines.close();
  await backupBlocks().close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-storage-vm-'));
  await rm(directory, { recursive: true, force: true });
}
