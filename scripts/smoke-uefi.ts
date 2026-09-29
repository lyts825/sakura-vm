import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-uefi-'));
const distro = process.argv[2] || 'debian';
if (distro !== 'debian' && distro !== 'ubuntu')
  throw new Error('Choose debian or ubuntu');
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-uefi-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { vmDir } = await import('../server/model.ts');
const { firmwareSupport } = await import('../server/firmware.ts');
const { inspectTrustedBoot } = await import('../server/trusted-boot.ts');
const engine = await createRuntime();
const machines = new Machines(engine);
await machines.init();
const log: string[] = [];
const record = (line: string) => { console.log(line); log.push(line); };

async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 300000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(300);
  }
  const result = await machines.exec(id, 'test -d /sys/firmware/efi && grep ^ID= /etc/os-release');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(distro));
  const trust = await inspectTrustedBoot(machines, id);
  assert.equal(trust.guest?.efi, true);
  assert.notEqual(trust.guest?.secureBootEnabled, true);
  assert.equal(trust.guest?.tpmDevicePresent, false);
  assert.equal(trust.ready, false);
  await machines.stop(id);
}

try {
  const support = await firmwareSupport();
  assert.equal(support.available, true, support.reason || 'OVMF missing');
  const vm = await machines.create({
    name: `${distro}-uefi`, distro, firmware: 'uefi', memoryMiB: 1024,
    cpus: 1, diskGiB: 4, accelerator: 'tcg',
  });
  await boot(vm.id);
  const vars = join(vmDir(vm.id), 'uefi-vars.fd');
  const first = await readFile(vars);
  assert.equal(first.length, support.varsBytes);
  record(`${distro} guest booted with UEFI/OVMF and persisted NVRAM`);
  await boot(vm.id);
  assert.equal((await stat(vars)).size, first.length);
  record(`${distro} guest rebooted using the same UEFI NVRAM`);
} finally {
  await machines.close();
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/uefi-smoke.log', log.join('\n') + '\n');
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  assert.ok(basename(directory).startsWith('sakura-uefi-'));
  await rm(directory, { recursive: true, force: true });
}
