import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchema } from '../server/model.ts';
import { hardwareCompatibility } from '../server/hardware-compatibility.ts';
import type { Machines } from '../server/machines.ts';

const deviceOutput = [
  'name "virtio-net-pci", bus PCI',
  'name "e1000", bus PCI',
  'name "virtio-rng-pci", bus PCI',
  'name "virtio-balloon-pci", bus PCI',
  'name "pc-dimm", desc "DIMM"',
].join('\n');
function fixture(
  options: {
    devices?: string;
    accelerators?: string;
    machine?: string;
    whpx?: boolean;
    config?: Record<string, unknown>;
  } = {},
) {
  const calls: string[] = [];
  const machines = {
    get: () => createSchema.parse({ name: 'matrix-vm', ...options.config }),
    engine: {
      version: 'QEMU test',
      whpxAvailable: options.whpx ?? false,
      run: async (_tool: string, args: string[]) => {
        calls.push(args.join(' '));
        if (args[0] === '-device') return options.devices ?? deviceOutput;
        if (args[0] === '-accel')
          return options.accelerators ?? 'Accelerators supported in QEMU binary:\ntcg\nwhpx';
        return options.machine ?? 'pc-q35-11.0 Standard PC';
      },
    },
  } as unknown as Machines;
  return { machines, calls };
}

test('matrix reports actual QEMU devices and distinguishes WHPX startup verification from binary support', async () => {
  const { machines, calls } = fixture();
  const report = await hardwareCompatibility(machines, 'vm');
  assert.deepEqual(calls.sort(), ['-accel help', '-device help', '-machine help']);
  assert.equal(report.ready, true);
  assert.equal(report.current.compatible, true);
  assert.equal(report.current.accelerator, 'tcg');
  assert.equal(report.matrix.accelerators.find((row) => row.id === 'whpx')?.available, false);
  assert.equal(report.matrix.devices.find((row) => row.id === 'pc-dimm')?.available, true);
  assert.match(report.limitation, /客户机驱动/);
  const onWhpx = await hardwareCompatibility(fixture({ whpx: true }).machines, 'vm');
  assert.equal(onWhpx.current.accelerator, 'whpx');
  assert.equal(onWhpx.matrix.accelerators.find((row) => row.id === 'whpx')?.available, true);
});

test('matrix identifies missing selected devices, incompatible accelerators and invalid NUMA without claiming guest support', async () => {
  const { machines } = fixture({
    devices: deviceOutput.replace('name "e1000", bus PCI\n', ''),
    config: {
      accelerator: 'whpx',
      hardware: {
        devices: { networkCard: 'e1000' },
      },
    },
  });
  const valid = machines.get('vm');
  machines.get = () => ({
    ...valid,
    hardware: {
      ...valid.hardware,
      cpu: { sockets: 1, cores: 2, threads: 1, numa: [{ memoryMiB: 512, cpus: [0] }] },
    },
  });
  const report = await hardwareCompatibility(machines, 'vm');
  assert.equal(report.ready, true);
  assert.equal(report.current.compatible, false);
  assert.match(report.current.issues.join('\n'), /WHPX|whpx/);
  assert.match(report.current.issues.join('\n'), /e1000/);
  assert.match(report.current.issues.join('\n'), /NUMA/);
});

test('failed QEMU probes are visible and prevent a successful report; cancellation is propagated', async () => {
  const { machines } = fixture();
  machines.engine.run = async (_tool, args) => {
    if (args[0] === '-device') throw new Error('QEMU device probe unavailable');
    return args[0] === '-accel' ? 'tcg' : 'pc-q35-11.0';
  };
  const report = await hardwareCompatibility(machines, 'vm');
  assert.equal(report.ready, false);
  assert.equal(report.current.compatible, false);
  assert.match(report.matrix.devices[0].reason || '', /device probe unavailable/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(hardwareCompatibility(machines, 'vm', abort.signal), { name: 'AbortError' });
});
