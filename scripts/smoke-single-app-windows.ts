import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-single-app-'));
await mkdir(join(directory, 'images'), { recursive: true });
await copyFile(resolve('.data/images/alpine-3.23.qcow2'),
  join(directory, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Desktops } = await import('../server/desktop.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const desktops = new Desktops(machines);
try {
  const vm = await machines.create({ name: 'single-app-smoke',
    memoryMiB: 1024, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300_000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(250);
  }
  const session = await desktops.apps.start(vm.id, { program: 'xterm',
    args: ['-hold', '-e', 'sh', '-c', 'sleep 120'] });
  const other = await desktops.apps.start(vm.id, { program: 'xterm',
    args: ['-hold', '-e', 'sh', '-c', 'sleep 120'] });
  assert.notEqual(other.port, session.port);
  assert.equal(await desktops.apps.port(vm.id, session.id), session.port);
  const handshake = await machines.exec(vm.id,
    `timeout 5 sh -c 'nc 127.0.0.1 ${session.port} | head -c 12'`, 10000);
  assert.match(handshake.stdout, /^RFB 003\./, JSON.stringify(handshake));
  assert.equal((await desktops.apps.list(vm.id)).filter((item) => item.status === 'running').length, 2);
  await desktops.apps.stop(vm.id, session.id);
  await delay(500);
  const stopped = await machines.exec(vm.id,
    `! nc -z 127.0.0.1 ${session.port} >/dev/null 2>&1`, 5000);
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.equal(await desktops.apps.port(vm.id, other.id), other.port);
  await desktops.apps.stop(vm.id, other.id);
  console.log('Real Alpine independent single-app Xvnc sessions, RFB handshake and cleanup passed');
} finally {
  await desktops.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-single-app-'));
  await rm(directory, { recursive: true, force: true });
}
