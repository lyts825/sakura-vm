import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-host-mount-smoke-'));
process.env.SAKURA_DATA_DIR = join(directory, 'data');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { HostMounts } = await import('../server/host-mount.ts');
const shared = join(directory, 'shared');
await mkdir(shared);
await writeFile(join(shared, 'host.txt'), 'host-visible\n');
const machines = new Machines(await createRuntime());
await machines.init();
const mounts = new HostMounts(machines);
await mounts.init();
try {
  const vm = await machines.create({ name: 'host-mount-smoke', memoryMiB: 512 });
  await machines.start(vm.id);
  const deadline = Date.now() + 270_000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(100);
  }
  await mounts.action(vm.id, { operation: 'configure',
    policy: { enabled: true, hostPath: shared, readOnly: false } });
  const read = await machines.exec(vm.id, 'cat /mnt/sakura-host/host.txt', 15_000);
  assert.equal(read.code, 0, read.stderr);
  assert.equal(read.stdout, 'host-visible\n');
  const write = await machines.exec(vm.id,
    "printf 'guest-visible\\n' > /mnt/sakura-host/guest.txt", 15_000);
  assert.equal(write.code, 0, write.stderr);
  assert.equal(await readFile(join(shared, 'guest.txt'), 'utf8'), 'guest-visible\n');
  const manipulated = await machines.exec(vm.id,
    'mkdir /mnt/sakura-host/nested && mv /mnt/sakura-host/guest.txt /mnt/sakura-host/nested/moved.txt && ls /mnt/sakura-host/nested && rm /mnt/sakura-host/nested/moved.txt && rmdir /mnt/sakura-host/nested',
    30_000);
  assert.equal(manipulated.code, 0, manipulated.stderr);
  assert.match(manipulated.stdout, /moved\.txt/);
  console.log('Host mount: guest read and write reached the selected host directory');
  await mounts.action(vm.id, { operation: 'configure',
    policy: { enabled: true, hostPath: shared, readOnly: true } });
  const denied = await machines.exec(vm.id,
    "printf bad > /mnt/sakura-host/denied.txt", 15_000);
  assert.notEqual(denied.code, 0);
  console.log('Host mount: read-only policy denied guest write');
  await machines.stop(vm.id);
  await machines.start(vm.id);
  const restartDeadline = Date.now() + 270_000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < restartDeadline, machines.logs.get(vm.id));
    await delay(100);
  }
  const remountDeadline = Date.now() + 45_000;
  while (!(await mounts.view(vm.id)).mounted) {
    assert.ok(Date.now() < remountDeadline,
      JSON.stringify((await mounts.view(vm.id)).observation));
    await delay(500);
  }
  const again = await machines.exec(vm.id, 'cat /mnt/sakura-host/host.txt', 15_000);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.stdout, 'host-visible\n');
  console.log('Host mount: policy restored after VM restart');
  await mounts.action(vm.id, { operation: 'unmount' });
  const state = await machines.exec(vm.id,
    'awk \'$2=="/mnt/sakura-host" {print $3}\' /proc/mounts', 15_000);
  assert.equal(state.stdout.trim(), '');
  console.log('Host mount: guest unmounted and policy disabled');
} finally {
  await mounts.close();
  await machines.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') ||
    resolve(directory).startsWith(resolve(tmpdir()) + '/'));
  await rm(directory, { recursive: true, force: true });
}
