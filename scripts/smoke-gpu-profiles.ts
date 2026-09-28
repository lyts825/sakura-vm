import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'sakura-gpu-profiles-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { probeGpuBackend } = await import('../server/gpu-profiles.ts');
const engine = await createRuntime();
let machines: InstanceType<typeof Machines> | undefined;
let vmId = '';
try {
  const probeMachines = { engine } as unknown as InstanceType<typeof Machines>;
  const twoD = await probeGpuBackend(probeMachines, 'virtio-gpu');
  assert.equal(twoD.available, true, twoD.reason);
  const virgl = await probeGpuBackend(probeMachines, 'virgl');
  console.log(`Virtio GPU 2D: available; VirGL 3D: ${virgl.available ? 'available' :
    `unavailable (${virgl.reason})`}`);
  machines = new Machines(engine);
  await machines.init();
  const vm = await machines.create({ name: 'gpu-profile-smoke', memoryMiB: 768,
    cpus: 1, diskGiB: 8, accelerator: 'auto', forwards: [] });
  vmId = vm.id;
  await machines.configureHardware(vmId, { devices: { graphics: 'virtio-gpu',
    graphicsOutputs: 2, graphicsWidth: 1600, graphicsHeight: 900,
    graphicsMemoryMiB: 384 } });
  await machines.start(vmId);
  const deadline = Date.now() + 120_000;
  while (machines.state(vmId) === 'starting' && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 100));
  assert.equal(machines.state(vmId), 'running', (machines.logs.get(vmId) || '').slice(-3000));
  const pci = await machines.exec(vmId,
    "grep -lE '^0x03[0-9a-fA-F]{4}$' /sys/bus/pci/devices/*/class", 10000);
  assert.equal(pci.code, 0, pci.stderr || pci.stdout);
  console.log('Alpine guest booted and enumerated the configured Virtio GPU PCI device.');
} finally {
  if (machines) {
    if (vmId && machines.live.has(vmId)) await machines.stop(vmId, true).catch(() => {});
    await machines.close();
  } else await engine.runtime.close();
  await rm(directory, { recursive: true, force: true });
}
