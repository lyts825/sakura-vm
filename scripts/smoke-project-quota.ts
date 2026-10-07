/** 烟雾验收：验证项目存储配额预检、超限与配置状态。
 * Smoke acceptance for project quota preflight, excess writes and configuration state. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-project-quota-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { projectQuota, readProjectQuotaRecord } = await import('../server/project-quota.ts');
const { createRuntime } = await import('../server/runtime.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);

/** 启动给定实例，然后轮询正式状态至 running；只在源码限定的启动期限内等待，超时将抛错。
 * Start the specified VM, then poll production state until running within the source-defined startup deadline; timeout fails. */
const boot = async (id: string) => {
  await machines.start(id);
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline) throw new Error('VM boot timeout');
    await delay(250);
  }
};
/** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
 * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
const run = async (id: string, command: string, timeout = 30000) => {
  const result = await machines.exec(id, command, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout || command);
  return result.stdout;
};

try {
  const vm = await machines.create({ name: 'quota-smoke', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  await boot(vm.id);
  await run(vm.id, `printf 'original-data' > /workspace/original.txt`);
  const initial = await projectQuota(machines, workspaces, vm.id, {}, 'check');
  assert.equal(initial.ready, true);
  assert.equal(initial.active, false);
  await run(vm.id, 'dd if=/dev/zero of=/workspace/too-large bs=1M count=80 >/dev/null 2>&1', 120000);
  await assert.rejects(
    projectQuota(machines, workspaces, vm.id, { mode: 'apply', limitMiB: 64 }, 'run'),
  );
  assert.equal(await readProjectQuotaRecord(vm.id, 'default'), null);
  await run(vm.id, 'test -f /workspace/too-large && rm /workspace/too-large');

  const applied = await projectQuota(machines, workspaces, vm.id,
    { mode: 'apply', limitMiB: 64 }, 'run');
  assert.equal(applied.ready, true);
  assert.equal(applied.active, true);
  assert.equal(applied.persistent, true);
  assert.equal((await run(vm.id, 'cat /workspace/original.txt')).trim(), 'original-data');
  await assert.rejects(
    workspaces.save(vm.id, { template: 'none', directory: '/workspace/other' }),
    /配额生效或恢复中/,
  );
  await assert.rejects(
    workspaces.projects.create(vm.id, 'overlap', async () => {
      await workspaces.save(vm.id, { template: 'none', directory: '/workspace/nested' });
    }),
    /受配额保护的项目重叠/,
  );
  const full = await machines.exec(vm.id,
    'dd if=/dev/zero of=/workspace/fill bs=1M count=80 >/dev/null 2>&1', 120000);
  assert.notEqual(full.code, 0, 'fixed-size project volume must reject writes beyond its limit');
  await run(vm.id, 'rm /workspace/fill');

  const grown = await projectQuota(machines, workspaces, vm.id,
    { mode: 'grow', limitMiB: 96 }, 'run');
  assert.equal(grown.ready, true);
  await run(vm.id, 'dd if=/dev/zero of=/workspace/expanded bs=1M count=60 >/dev/null 2>&1', 120000);
  await run(vm.id, 'umount /workspace');
  const escaped = await machines.exec(vm.id, 'touch /workspace/blocked');
  assert.notEqual(escaped.code, 0, 'unmounted quota directory must reject writes');
  await assert.rejects(workspaces.run(vm.id, 'start'), /项目配额未挂载/);
  await run(vm.id, 'mount /workspace');
  await machines.stop(vm.id);
  await boot(vm.id);
  const restarted = await projectQuota(machines, workspaces, vm.id, {}, 'check');
  assert.equal(restarted.ready, true);
  assert.equal(restarted.active, true);
  assert.equal((await run(vm.id, 'cat /workspace/original.txt')).trim(), 'original-data');
  await run(vm.id, 'test -f /workspace/expanded');

  const cleared = await projectQuota(machines, workspaces, vm.id,
    { mode: 'clear' }, 'run');
  assert.equal(cleared.ready, true);
  assert.equal(cleared.active, false);
  assert.equal((await run(vm.id, 'cat /workspace/original.txt')).trim(), 'original-data');
  await run(vm.id, 'test -f /workspace/expanded');
  await workspaces.save(vm.id, { template: 'none', directory: '/workspace/other' });
  console.log('Alpine project quota passed: migrate, enforce, grow, reboot, clear, retain data.');
  await machines.stop(vm.id);

  const debian = await machines.create({
    name: 'quota-debian-smoke', distro: 'debian', memoryMiB: 1024, cpus: 2, diskGiB: 4,
  });
  await boot(debian.id);
  await run(debian.id, `printf 'debian-data' > /workspace/original.txt`);
  const debianApplied = await projectQuota(machines, workspaces, debian.id,
    { mode: 'apply', limitMiB: 64 }, 'run');
  assert.equal(debianApplied.ready, true);
  await machines.stop(debian.id);
  await boot(debian.id);
  const debianRestarted = await projectQuota(machines, workspaces, debian.id, {}, 'check');
  assert.equal(debianRestarted.ready, true);
  assert.equal(debianRestarted.active, true);
  assert.equal((await run(debian.id, 'cat /workspace/original.txt')).trim(), 'debian-data');
  const debianCleared = await projectQuota(machines, workspaces, debian.id, { mode: 'clear' }, 'run');
  assert.equal(debianCleared.ready, true);
  console.log('Debian project quota passed: apply, reboot, clear.');
} finally {
  await workspaces.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
