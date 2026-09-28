import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const data = await mkdtemp(join(tmpdir(), 'sakura-arm64-smoke-'));
assert.equal(dirname(data), resolve(tmpdir()));
assert.match(basename(data), /^sakura-arm64-smoke-/);
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const machines = new Machines(await createRuntime());
await machines.init();
let id: string | undefined;
async function waitRunning(vmId: string) {
  const deadline = Date.now() + 600_000;
  while (machines.state(vmId) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(vmId)))
      throw new Error(machines.logs.get(vmId));
    await delay(500);
  }
}
try {
  const vm = await machines.create({ name: 'debian-arm64-smoke', distro: 'debian',
    architecture: 'aarch64', firmware: 'uefi', accelerator: 'tcg',
    memoryMiB: 1024, diskGiB: 4, cpus: 2 });
  id = vm.id;
  assert.equal(machines.commandline(id).machine, 'virt');
  await machines.start(id);
  await waitRunning(id);
  const first = await machines.exec(id, 'uname -m; cat /etc/os-release | grep ^ID=');
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /^aarch64\r?\nID=debian/m);
  const saved = JSON.parse(await readFile(join(data, 'machines.json'), 'utf8'));
  assert.equal(saved.find((item: { id: string }) => item.id === id)?.architecture, 'aarch64');
  await machines.stop(id, false);
  await machines.start(id);
  await waitRunning(id);
  const second = await machines.exec(id, 'uname -m');
  assert.equal(second.stdout.trim(), 'aarch64');
  console.log('Debian ARM64 booted on QEMU virt and survived restart.');
} finally {
  if (id) {
    if (['running', 'paused', 'starting'].includes(machines.state(id)))
      await machines.stop(id, true).catch(() => {});
    await machines.delete(id).catch(() => {});
  }
  await machines.close();
  await rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
