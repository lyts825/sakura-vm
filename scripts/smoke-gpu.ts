import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-gpu-vm-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { checkGpuAcceleration, runGpuAcceleration } = await import('../server/gpu-acceleration.ts');
const machines = new Machines(await createRuntime());
await machines.init();
try {
  if (process.env.SAKURA_GPU_DEBIAN_ONLY !== '1' &&
      process.env.SAKURA_GPU_UBUNTU_ONLY !== '1') {
  const vm = await machines.create({ name: 'gpu-smoke', memoryMiB: 1024,
    cpus: 2, diskGiB: 4, accelerator: 'tcg',
    hardware: { devices: { graphics: 'virgl' } } });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  const result = await machines.exec(vm.id,
    'test -e /dev/dri/renderD128 && dmesg | grep -q "features: +virgl"', 30000);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const before = await checkGpuAcceleration(machines, vm.id);
  assert.equal(before.ready, false);
  const mesa = await runGpuAcceleration(machines, vm.id, { mode: 'install-mesa' });
  assert.equal(mesa.ready, true, mesa.reason);
  assert.ok('renderer' in mesa);
  assert.match(mesa.renderer || '', /^virgl\b/i);
  const after = await checkGpuAcceleration(machines, vm.id);
  assert.equal(after.ready, true);
  console.log('Real guest Mesa renderer:', after.renderer);
  await machines.stop(vm.id, false);
  const twoD = await machines.create({ name: 'gpu-2d-smoke', memoryMiB: 512,
    cpus: 2, diskGiB: 4, accelerator: 'tcg',
    hardware: { devices: { graphics: 'virtio-gpu' } } });
  await machines.start(twoD.id);
  const twoDDeadline = Date.now() + 300000;
  while (machines.state(twoD.id) !== 'running') {
    assert.equal(machines.state(twoD.id), 'starting', machines.logs.get(twoD.id));
    assert.ok(Date.now() < twoDDeadline, machines.logs.get(twoD.id));
    await delay(300);
  }
  const twoDCheck = await checkGpuAcceleration(machines, twoD.id);
  assert.equal(twoDCheck.ready, true, twoDCheck.reason);
  console.log('Real guest Virtio GPU 2D DRM device detected.');
  await machines.stop(twoD.id, false);
  }
  const aptDistro = process.env.SAKURA_GPU_UBUNTU_ONLY === '1' ? 'ubuntu' : 'debian';
  const aptVm = await machines.create({ name: `gpu-${aptDistro}-smoke`, distro: aptDistro,
    memoryMiB: 2048, cpus: 2, diskGiB: 8, accelerator: 'auto',
    hardware: { devices: { graphics: 'virgl' } } });
  await machines.start(aptVm.id);
  const aptDeadline = Date.now() + 300000;
  while (machines.state(aptVm.id) !== 'running') {
    assert.equal(machines.state(aptVm.id), 'starting', machines.logs.get(aptVm.id));
    assert.ok(Date.now() < aptDeadline, machines.logs.get(aptVm.id));
    await delay(300);
  }
  const aptCheck = await runGpuAcceleration(machines, aptVm.id, { mode: 'install-mesa' });
  if (!aptCheck.ready) {
    const module = await machines.exec(aptVm.id,
      'uname -r; modprobe virtio_gpu; ls -l /dev/dri 2>&1; find /lib/modules -iname "*virtio*gpu*" | head -10',
      30000);
    const diagnostics = await machines.exec(aptVm.id,
      'command -v eglinfo; ls -l /dev/dri 2>&1; dmesg | grep -i -E "virtio.*gpu|drm|virgl" | tail -20; dpkg -l mesa-utils-extra libegl1-mesa libgl1-mesa-dri',
      30000);
    console.log(`${aptDistro} GPU diagnostics:`, aptCheck, module.stdout, module.stderr,
      diagnostics.stdout, diagnostics.stderr);
  }
  assert.equal(aptCheck.ready, true, aptCheck.reason);
  if ('pendingReboot' in aptCheck && aptCheck.pendingReboot) {
    await machines.stop(aptVm.id, false);
    await machines.start(aptVm.id);
    const rebootDeadline = Date.now() + 300000;
    while (machines.state(aptVm.id) !== 'running') {
      assert.equal(machines.state(aptVm.id), 'starting', machines.logs.get(aptVm.id));
      assert.ok(Date.now() < rebootDeadline, machines.logs.get(aptVm.id));
      await delay(300);
    }
  }
  const finalApt = await checkGpuAcceleration(machines, aptVm.id);
  if (!finalApt.ready) {
    const boot = await machines.exec(aptVm.id,
      'uname -r; ls -l /dev/dri 2>&1; EGL_PLATFORM=gbm eglinfo -p gbm -B >/tmp/sakura-egl.txt 2>&1; echo egl-exit:$?; grep -i -E "renderer|GBM platform|vendor|error|failed" /tmp/sakura-egl.txt | head -30; head -35 /tmp/sakura-egl.txt',
      30000);
    console.log(`${aptDistro} boot diagnostics:`, aptCheck, finalApt,
      boot.stdout, boot.stderr);
  }
  assert.equal(finalApt.ready, true, finalApt.reason);
  assert.ok(finalApt.verifiedBy === 'gl-renderer' ||
    finalApt.verifiedBy === 'gbm-driver-and-virgl-device');
  console.log(`Real ${aptDistro} Mesa GPU verification:`, finalApt.verifiedBy,
    finalApt.renderer);
} finally {
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-gpu-vm-'));
  await rm(directory, { recursive: true, force: true });
}
