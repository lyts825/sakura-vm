import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
const directory = await mkdtemp(join(tmpdir(), 'sakura-observability-vm-'));
await mkdir(join(directory, 'images'));
await copyFile(resolve('.data/images/alpine-3.23.qcow2'), join(directory, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const { readAvailabilityReport } = await import('../server/availability.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const plugins = ['automation', 'automation-scheduler', 'backups'];
let features = await Features.create(machines, plugins);
try {
  const vm = await machines.create({ name: 'monitoring-proof', cpus: 1, memoryMiB: 512, diskGiB: 4 });
  console.log('Booting isolated monitoring guest');
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(300);
  }
  await features.suite.update(vm.id, {
    alerts: { enabled: true, cpuPercent: 100, memoryPercent: 100, diskPercent: 100 },
  });
  const first = await features.suite.sample(vm.id);
  assert.ok(first.networkReceivedBytes! > 0);
  await features.suite.tick();
  await machines.writeGuestFile(vm.id, '/workspace/traffic.txt', 'a'.repeat(65536), false);
  await delay(3500);
  const second = await features.suite.sample(vm.id);
  assert.ok(second.networkReceiveBytesPerSecond! > 0, JSON.stringify(second));
  assert.ok(second.networkTransmitBytesPerSecond! > 0, JSON.stringify(second));
  await features.suite.tick();
  console.log('Real Linux interface counters and traffic rates were persisted');
  await machines.stop(vm.id, false);
  await features.backups.run(vm.id);
  await features.backups.jobs.wait(vm.id);
  assert.equal(features.backups.jobs.view(vm.id)!.status, 'done');
  const backup = (await features.backups.view(vm.id)).items[0];
  const download = await features.backups.downloadable(vm.id, backup.id);
  assert.equal(download.type, 'file');
  // Deliberately corrupt only the isolated backup to exercise the actual verification failure path.
  const file = await open(download.path, 'r+');
  try {
    const position = (await file.stat()).size - 1,
      value = Buffer.alloc(1);
    await file.read(value, 0, 1, position);
    value[0] ^= 255;
    await file.write(value, 0, 1, position);
  } finally {
    await file.close();
  }
  await features.backups.operate(vm.id, backup.id, 'verify');
  await features.backups.jobs.wait(vm.id);
  assert.equal(features.backups.jobs.view(vm.id)!.status, 'error');
  await features.suite.tick();
  const event = (await features.suite.view(vm.id)).events.find((item) => item.kind === 'backup');
  assert.ok(event, 'Actual failed backup verification must create a notification');
  assert.equal(event.jobId, features.backups.jobs.view(vm.id)!.id);
  await features.suite.acknowledge(vm.id, event.id);
  await features.close();
  features = await Features.create(machines, plugins);
  await features.suite.tick();
  const restored = await features.suite.view(vm.id);
  assert.equal(restored.events.filter((item) => item.kind === 'backup').length, 1);
  assert.equal(restored.events.find((item) => item.id === event.id)!.acknowledged, true);
  assert.ok(restored.history.some((point) => point.networkReceiveBytesPerSecond! > 0));
  const availability = await readAvailabilityReport(vm.id, 1);
  assert.ok(availability.durationsSeconds.running > 0, JSON.stringify(availability));
  assert.equal(availability.lastStatus, 'stopped');
  console.log('Observed uptime and stopped state survived restart; unsampled time remains unknown');
  console.log(
    'Actual backup failure, notification acknowledgement and metric history survived controller restart',
  );
} finally {
  await features.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-observability-vm-'));
  await rm(directory, { recursive: true, force: true });
}
