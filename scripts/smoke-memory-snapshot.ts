/** 烟雾验收：验证RAM、进程和磁盘状态的多次恢复及来宾重启后的恢复。
 * Smoke acceptance for repeated RAM/process/disk restoration and post-guest-reboot recovery. */
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-memory-snapshot-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-memory-snapshot-'));
await mkdir(join(directory, 'images'), { recursive: true });
await copyFile(resolve('.data/images/alpine-3.23.qcow2'), join(directory, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { networkRuntime } = await import('../server/network/index.ts');
const machines = new Machines(await createRuntime());
await machines.init();

/** 启动给定实例，然后轮询正式状态至 running；只在源码限定的启动期限内等待，超时或停止/错误状态将抛错并附启动日志。
 * Start the specified VM, then poll production state until running within the source-defined startup deadline; timeout or stopped/error state fails with boot logs. */
async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 270_000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(250);
  }
}

/** 读取内存快照标记并探测记录 PID 存活，断言文本与预期 alive/dead 同时匹配，以区分磁盘和内存恢复。
 * Read the memory-snapshot marker/probe recorded PID liveness and assert text plus expected alive/dead together to distinguish disk/memory restoration. */
async function check(id: string, expected: string, processAlive: boolean) {
  const result = await machines.exec(id,
    'cat /workspace/memory-snapshot.txt; echo; kill -0 "$(cat /workspace/memory-snapshot.pid)" 2>/dev/null && echo alive || echo dead');
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [expected, processAlive ? 'alive' : 'dead']);
}

let vmId: string | undefined;
try {
  const vm = await machines.create({ name: 'memory-snapshot-smoke', memoryMiB: 512, cpus: 2,
    diskGiB: 4, accelerator: 'tcg' });
  vmId = vm.id;
  console.log('Booting isolated Alpine/QEMU guest');
  await boot(vm.id);
  const prepared = await machines.exec(vm.id,
    'printf before > /workspace/memory-snapshot.txt; sleep 3600 >/dev/null 2>&1 & echo $! > /workspace/memory-snapshot.pid; sync');
  assert.equal(prepared.code, 0, prepared.stdout + prepared.stderr);
  await check(vm.id, 'before', true);
  console.log('Guest process ready');

  const snapshot = await machines.memorySnapshot(vm.id, 'running-baseline');
  assert.equal(snapshot.consistency, 'vmstate');
  assert.ok(snapshot.stateFingerprint);
  console.log('Saved VM state');
  for (let attempt = 0; attempt < 2; attempt++) {
    await machines.exec(vm.id,
      'kill "$(cat /workspace/memory-snapshot.pid)"; printf after > /workspace/memory-snapshot.txt; sync');
    await check(vm.id, 'after', false);

    const firstNetwork = machines.live.get(vm.id)!.network!;
    await machines.restoreMemory(vm.id, snapshot.id);
    assert.equal(firstNetwork.signal.aborted, true);
    assert.notEqual(machines.live.get(vm.id)!.network!.generation, firstNetwork.generation);
    assert.equal(networkRuntime.snapshot().vms.length, 1);
    assert.equal(networkRuntime.snapshot().vms[0].connected, true);
    console.log('Restored VM state in running guest', attempt + 1);
    await check(vm.id, 'before', true);
  }

  await machines.stop(vm.id);
  await boot(vm.id);
  console.log('Rebooted guest');
  for (let attempt = 0; attempt < 2; attempt++) {
    await machines.exec(vm.id, 'printf changed > /workspace/memory-snapshot.txt; sync');
    await machines.restoreMemory(vm.id, snapshot.id);
    await check(vm.id, 'before', true);
  }
  console.log('PASS repeated RAM, process and disk state restoration live and after a guest restart');
} catch (error) {
  if (vmId) console.error('Guest status:', machines.state(vmId), machines.logs.get(vmId));
  throw error;
} finally {
  await machines.close();
  await networkRuntime.close();
  await rm(directory, { recursive: true, force: true });
}
