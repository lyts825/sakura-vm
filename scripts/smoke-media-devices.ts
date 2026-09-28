import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'sakura-media-devices-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { probeAudioBackend } = await import('../server/media-devices.ts');
const engine = await createRuntime();
let machines: InstanceType<typeof Machines> | undefined;
let vmId = '';
try {
  const target = { engine } as unknown as InstanceType<typeof Machines>;
  const virtual = await probeAudioBackend(target, 'none');
  assert.equal(virtual.available, true, virtual.reason);
  const host = await probeAudioBackend(target, 'dsound');
  console.log(`DirectSound backend: ${host.available ? 'available' :
    `unavailable (${host.reason})`}`);
  machines = new Machines(engine);
  await machines.init();
  const vm = await machines.create({ name: 'media-device-smoke', memoryMiB: 768,
    cpus: 1, diskGiB: 8, accelerator: 'auto', forwards: [] });
  vmId = vm.id;
  await machines.configureHardware(vmId, { devices: { audio: 'hda-duplex',
    audioBackend: host.available ? 'dsound' : 'none' } });
  await machines.start(vmId);
  const deadline = Date.now() + 120_000;
  while (machines.state(vmId) === 'starting' && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 100));
  assert.equal(machines.state(vmId), 'running', (machines.logs.get(vmId) || '').slice(-3000));
  const device = await machines.exec(vmId,
    "grep -lE '^0x0403[0-9a-fA-F]{2}$' /sys/bus/pci/devices/*/class", 10000);
  assert.equal(device.code, 0, device.stderr || device.stdout);
  console.log('Alpine guest booted and enumerated the HDA audio PCI device.');
} finally {
  if (machines) {
    if (vmId && machines.live.has(vmId)) await machines.stop(vmId, true).catch(() => {});
    await machines.close();
  } else await engine.runtime.close();
  await rm(directory, { recursive: true, force: true });
}
