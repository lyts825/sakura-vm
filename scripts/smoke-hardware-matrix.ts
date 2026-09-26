import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-hardware-matrix-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-hardware-matrix-'));
process.env.SAKURA_DATA_DIR = directory;
const { createRuntime } = await import('../server/runtime.ts');
const { createSchema } = await import('../server/model.ts');
const { hardwareCompatibility } = await import('../server/hardware-compatibility.ts');
const engine = await createRuntime();
try {
  const machines = {
    engine,
    get: () => createSchema.parse({ name: 'matrix-real', accelerator: 'auto' }),
  } as unknown as Machines;
  const report = await hardwareCompatibility(machines, 'matrix-real');
  assert.equal(report.ready, true, JSON.stringify(report.probes));
  assert.equal(report.current.compatible, true, report.current.issues.join('\n'));
  for (const device of ['virtio-net-pci', 'e1000', 'virtio-rng-pci', 'virtio-balloon-pci', 'pc-dimm'])
    assert.equal(report.matrix.devices.find((row) => row.id === device)?.available, true, device);
  assert.equal(report.matrix.accelerators.find((row) => row.id === 'tcg')?.available, true);
  assert.equal(report.matrix.accelerators.find((row) => row.id === 'whpx')?.available, engine.whpxAvailable);
  console.log(
    `QEMU hardware matrix passed: ${engine.version}; default accelerator ${report.current.accelerator}`,
  );
} finally {
  await engine.runtime.close();
  await rm(directory, { recursive: true, force: true });
}
