import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-guest-quota-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { projectQuota } = await import('../server/project-quota.ts');
const { guestQuota } = await import('../server/guest-quota.ts');
const { createRuntime } = await import('../server/runtime.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);

async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline) throw new Error('VM boot timeout');
    await delay(250);
  }
}
async function run(id: string, command: string, timeout = 30000) {
  const result = await machines.exec(id, command, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout || command);
  return result.stdout.trim();
}
async function enforced(id: string, name: string) {
  const result = await machines.exec(id,
    `su quotauser ${name === 'alpine' ? '' : '-s /bin/sh'} -c ` +
    `'dd if=/dev/zero of=/workspace/user/over-limit bs=1M count=40'`, 120000);
  assert.notEqual(result.code, 0, `${name}: user quota must reject writes beyond 20 MiB`);
  assert.match(result.stderr, /[Qq]uota/);
  await run(id, 'rm -f /workspace/user/over-limit');
}

try {
  for (const distro of ['alpine', 'debian', 'ubuntu'].filter((item) =>
    !process.argv[2] || process.argv[2] === item) as Array<'alpine' | 'debian' | 'ubuntu'>) {
    const vm = await machines.create({
      name: `guest-quota-${distro}`, distro, memoryMiB: distro === 'alpine' ? 512 : 1024,
      cpus: 2, diskGiB: 4,
    });
    await boot(vm.id);
    const absent = await guestQuota(machines, workspaces, vm.id, {}, 'check');
    assert.equal(absent.ready, false);
    await projectQuota(machines, workspaces, vm.id, { mode: 'apply', limitMiB: 96 }, 'run');
    if (distro === 'alpine') {
      await run(vm.id, 'apk add --no-cache quota-tools', 300000);
      await run(vm.id, 'adduser -D quotauser');
    } else {
      await run(vm.id,
        'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq quota', 300000);
      if (distro === 'ubuntu') {
        const withoutModules = await guestQuota(machines, workspaces, vm.id, {}, 'check');
        assert.equal(withoutModules.ready, false);
        assert.match(withoutModules.reason || '', /linux-modules-extra/);
        await run(vm.id,
          'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq linux-modules-extra-$(uname -r)',
          300000);
      }
      await run(vm.id, 'useradd -m quotauser');
    }
    const uid = Number(await run(vm.id, 'id -u quotauser'));
    await run(vm.id, 'mkdir /workspace/user; chown quotauser:quotauser /workspace/user');
    const set = await guestQuota(machines, workspaces, vm.id,
      { mode: 'set', uid, hardMiB: 20 }, 'run');
    assert.equal(set.ready, true);
    assert.equal(set.active, true);
    assert.match(set.report, /20480/);
    await enforced(vm.id, distro);
    await machines.stop(vm.id);
    await boot(vm.id);
    const status = await guestQuota(machines, workspaces, vm.id, { uid }, 'check');
    assert.equal(status.ready, true);
    assert.equal(status.active, true);
    await enforced(vm.id, distro);
    const cleared = await guestQuota(machines, workspaces, vm.id,
      { mode: 'clear', uid }, 'run');
    assert.equal(cleared.ready, true);
    await run(vm.id, `su quotauser ${distro === 'alpine' ? '' : '-s /bin/sh'} -c ` +
      `'dd if=/dev/zero of=/workspace/user/unlimited bs=1M count=30 >/dev/null 2>&1'`, 120000);
    const volumeCleared = await projectQuota(machines, workspaces, vm.id, { mode: 'clear' }, 'run');
    assert.equal(volumeCleared.ready, true);
    console.log(`${distro} guest UID quota passed: enforce, reboot, clear and volume removal.`);
    await machines.stop(vm.id);
  }
} finally {
  await workspaces.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
