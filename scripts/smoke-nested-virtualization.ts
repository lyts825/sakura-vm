import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Workspaces } from '../server/workspaces.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-nested-vm-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-nested-vm-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { NextFeatures } = await import('../server/next-features.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = {
  projects: { current: () => 'default', key: (id: string) => id },
} as unknown as Workspaces;
const features = new NextFeatures(machines, workspaces);
const observation = z
  .object({
    ready: z.boolean(),
    kernel: z.string(),
    cpuExtension: z.enum(['vmx', 'svm']).nullable(),
    kvmDevice: z.boolean(),
    nestedCandidate: z.boolean(),
  })
  .passthrough();
try {
  const vm = await machines.create({ name: 'nested-smoke', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(200);
  }
  const checked = observation.parse(
    await features.action(vm.id, { action: 'check', featureId: 'nested-virtualization' }),
  );
  assert.equal(checked.ready, true, JSON.stringify(checked));
  assert.ok(checked.kernel);
  assert.equal(checked.nestedCandidate, Boolean(checked.cpuExtension && checked.kvmDevice));
  const job = z
    .object({ status: z.string(), id: z.string().optional(), error: z.string().optional() })
    .parse(await features.action(vm.id, { action: 'run', featureId: 'nested-virtualization' }));
  await features.jobs.wait(`${vm.id}:nested-virtualization`);
  assert.equal(features.jobs.get(job.id!)?.status, 'done', features.jobs.get(job.id!)?.error);
  const result = await features.jobs.result(job.id!);
  assert.equal(result.executed, true);
  assert.equal((await features.view(vm.id)).executions.length, 2);
  console.log(
    `Real guest nested probe passed: CPU=${checked.cpuExtension || 'none'}, /dev/kvm=${checked.kvmDevice}.`,
  );
} finally {
  await features.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
