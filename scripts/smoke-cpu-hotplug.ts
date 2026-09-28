import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const data = await mkdtemp(join(tmpdir(), 'sakura-debian-hotplug-'));
assert.equal(dirname(data), resolve(tmpdir()));
assert.match(basename(data), /^sakura-debian-hotplug-/);
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { resourceAction } = await import('../server/resource-actions.ts');
const machines = new Machines(await createRuntime());
await machines.init();
let id: string | undefined;
try {
  const vm = await machines.create({ name: 'debian-hotplug-probe', distro: 'debian',
    memoryMiB: 1024, diskGiB: 4, cpus: 1, accelerator: 'tcg' });
  id = vm.id;
  const signal = new AbortController().signal;
  const configured = await resourceAction(machines, id, 'vcpu-hotplug',
    { mode: 'configure', maximum: 2 }, signal) as any;
  assert.equal(configured.vm.hardware.cpu.cores, 2);
  await machines.start(id);
  const deadline = Date.now() + 300_000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(250);
  }
  const available = await resourceAction(machines, id, 'vcpu-hotplug',
    { mode: 'view' }, signal) as any;
  assert.equal(available.canAdd, true, JSON.stringify(available));
  assert.equal(available.current, 1);
  assert.equal(available.maximum, 2);
  assert.ok(available.guestPossible >= 2);
  const result = await resourceAction(machines, id, 'vcpu-hotplug',
    { mode: 'add', target: 2 }, signal) as any;
  assert.equal(result.ready, true, JSON.stringify(result));
  assert.equal(result.current, 2);
  assert.equal(result.guestOnline, 2);
  assert.equal(machines.get(id).cpus, 2);
  await machines.stop(id, false);
  await machines.start(id);
  const restartDeadline = Date.now() + 300_000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > restartDeadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(250);
  }
  const online = await machines.exec(id, 'grep -c ^processor /proc/cpuinfo');
  assert.equal(Number(online.stdout.trim()), 2);
  console.log('Debian/TCG CPU hotplug reached two online CPUs and survived restart.');
} finally {
  if (id) {
    if (machines.state(id) === 'running' || machines.state(id) === 'paused')
      await machines.stop(id, true).catch(() => {});
    await machines.delete(id).catch(() => {});
  }
  await machines.close();
  await rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
