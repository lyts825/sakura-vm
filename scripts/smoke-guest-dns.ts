import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Workspaces } from '../server/workspaces.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-guest-dns-smoke-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.match(basename(directory), /^sakura-guest-dns-smoke-/);
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
try {
  const vm = await machines.create({ name: 'guest-dns-smoke', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(200);
  }
  const checked = z.object({
    ready: z.literal(true),
    nameservers: z.array(z.string()).min(1),
    dnssecTools: z.array(z.string()),
    dnssecValidation: z.literal('not-verified'),
  }).parse(await features.action(vm.id, { action: 'check', featureId: 'private-dns-dnssec' }));
  const job = z.object({ id: z.string() }).parse(
    await features.action(vm.id, { action: 'run', featureId: 'private-dns-dnssec' }),
  );
  await features.jobs.wait(`${vm.id}:private-dns-dnssec`);
  assert.equal(features.jobs.get(job.id)?.status, 'done', features.jobs.get(job.id)?.error);
  const result = await features.jobs.result(job.id);
  assert.equal(result.executed, true);
  assert.deepEqual(result.nameservers, checked.nameservers);
  console.log(`Real guest DNS diagnostic passed: ${checked.nameservers.length} resolver(s), ${checked.dnssecTools.length} DNSSEC tool(s).`);
} finally {
  await features.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
