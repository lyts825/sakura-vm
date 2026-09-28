import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-memory-reclaim-smoke-'));
assert.equal(dirname(directory), resolve(tmpdir()));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { MemoryReclaim } = await import('../server/memory-reclaim.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const reclaim = new MemoryReclaim(machines);
await reclaim.init();
const lines: string[] = [];
try {
  const vm = await machines.create({ name: 'memory-reclaim-smoke', memoryMiB: 1024, cpus: 2 });
  await machines.start(vm.id);
  const deadline = Date.now() + 270_000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(100);
  }
  await reclaim.action(vm.id, { operation: 'configure', policy: { enabled: true, minMiB: 512 } });
  for (let i = 0; i < 3; i++) await reclaim.action(vm.id, { operation: 'sample' });
  const observed = await reclaim.view(vm.id);
  assert.ok(observed.observation);
  assert.equal(observed.observation.decision, 'shrink', JSON.stringify(observed.observation));
  assert.equal(observed.currentTargetMiB, 960);
  assert.equal((await machines.view(vm.id)).memoryTargetMiB, 960);
  lines.push('Real QEMU: guest MemAvailable sampling triggered Virtio balloon target 1024 → 960 MiB.');
  await machines.stop(vm.id);
  assert.equal(machines.state(vm.id), 'stopped');
  console.log(lines.at(-1));
} finally {
  await reclaim.close();
  await machines.close();
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/memory-reclaim-smoke.log'), lines.join('\n') + '\n');
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  assert.ok(basename(directory).startsWith('sakura-memory-reclaim-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
