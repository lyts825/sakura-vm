import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'sakura-build-farm-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { BuildFarm } = await import('../server/build-farm.ts');
const engine = await createRuntime();
let machines: InstanceType<typeof Machines> | undefined;
let farm: InstanceType<typeof BuildFarm> | undefined;
let vmId = '';
try {
  machines = new Machines(engine);
  await machines.init();
  const vm = await machines.create({ name: 'build-farm-smoke', memoryMiB: 768,
    cpus: 1, diskGiB: 8, accelerator: 'auto', forwards: [] });
  vmId = vm.id;
  await machines.start(vmId);
  const bootDeadline = Date.now() + 120_000;
  while (machines.state(vmId) === 'starting' && Date.now() < bootDeadline)
    await new Promise((done) => setTimeout(done, 100));
  assert.equal(machines.state(vmId), 'running');
  farm = new BuildFarm(machines);
  await farm.init();
  await farm.action({ operation: 'save-node', node: {
    vmId, slots: 1, labels: ['alpine'], enabled: true } });
  const submitted = await farm.action({ operation: 'submit', build: {
    name: 'Alpine farm job', command: 'printf farm-ok > /workspace/farm-result.txt',
    cwd: '/workspace', labels: ['alpine'], timeoutSeconds: 30 } }) as { id: string };
  const deadline = Date.now() + 45_000;
  while (farm.view().tasks.find((task) => task.id === submitted.id)?.status !== 'done' &&
    Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
  const task = farm.view().tasks.find((item) => item.id === submitted.id);
  assert.equal(task?.status, 'done', task?.error || task?.job?.error);
  const result = await machines.exec(vmId, 'cat /workspace/farm-result.txt', 10000);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'farm-ok');
  console.log('Queued build ran on a real Alpine VM and wrote the expected artifact.');
} finally {
  if (farm) await farm.close();
  if (machines) {
    if (vmId && machines.live.has(vmId)) await machines.stop(vmId, true).catch(() => {});
    await machines.close();
  } else await engine.runtime.close();
  await rm(directory, { recursive: true, force: true });
}
