/** 烟雾验收：验证项目 UID 配额的超限写入拒绝、重启、清除和卷移除。
 * Smoke acceptance for project-UID quota write refusal, reboot, reset and volume retirement. */
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

/** 启动给定实例，然后轮询正式状态至 running；只在源码限定的启动期限内等待，超时将抛错。
 * Start the specified VM, then poll production state until running within the source-defined startup deadline; timeout fails. */
async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline) throw new Error('VM boot timeout');
    await delay(250);
  }
}
/** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
 * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
async function run(id: string, command: string, timeout = 30000) {
  const result = await machines.exec(id, command, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout || command);
  return result.stdout.trim();
}
/** 以非 root 配额账号尝试超过二十 MiB 的写入，要求非零和 Quota 错误，随后删除本次越额文件。
 * Attempt a write beyond twenty MiB as the quota user, requiring nonzero/Quota diagnostics before removing this oversized fixture file. */
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
