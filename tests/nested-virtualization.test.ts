import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Engine } from '../server/runtime.ts';
import type { Workspaces } from '../server/workspaces.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-nested-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { NextFeatures, nextFeatureCatalog } = await import('../server/next-features.ts');
const { createSchema } = await import('../server/model.ts');
const baseResult = z.object({ ready: z.boolean(), executed: z.boolean() }).passthrough();
const observation = baseResult.extend({
  cpuExtension: z.enum(['vmx', 'svm']).nullable(),
  kvmDevice: z.boolean(),
  nestedCandidate: z.boolean(),
  accelerator: z.string().nullable(),
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

test('nested virtualization records actual guest flags and KVM availability without claiming a second VM boot', async () => {
  assert.equal(nextFeatureCatalog.find(([id]) => id === 'nested-virtualization')?.[5], 'available');
  const machines = new Machines({} as Engine),
    id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'nested-test' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  const workspaces = {
    beforeConfigChange: () => () => {},
    projects: { current: () => 'default', key: (vmId: string) => vmId },
  } as unknown as Workspaces;
  const features = new NextFeatures(machines, workspaces);
  try {
    const stopped = baseResult.parse(
      await features.action(id, { action: 'check', featureId: 'nested-virtualization' }),
    );
    assert.equal(stopped.ready, false);
    machines.live.set(id, { status: 'running', accelerator: 'tcg' } as any);
    const commands: string[] = [];
    machines.exec = async (_id, command) => {
      commands.push(command);
      return { code: 0, stdout: 'CPU=flags\t: fpu vmx hypervisor\nKVM=yes\nKERNEL=6.18.3\n', stderr: '' };
    };
    const checked = observation.parse(
      await features.action(id, { action: 'check', featureId: 'nested-virtualization' }),
    );
    assert.equal(checked.ready, true);
    assert.equal(checked.executed, false);
    assert.equal(checked.cpuExtension, 'vmx');
    assert.equal(checked.kvmDevice, true);
    assert.equal(checked.nestedCandidate, true);
    assert.equal(checked.accelerator, 'tcg');
    assert.equal(commands.length, 1);
    const job = z
      .object({ status: z.string(), id: z.string().optional(), error: z.string().optional() })
      .parse(await features.action(id, { action: 'run', featureId: 'nested-virtualization' }));
    await features.jobs.wait(`${id}:nested-virtualization`);
    assert.equal(features.jobs.get(job.id!)?.status, 'done', features.jobs.get(job.id!)?.error);
    const result = await features.jobs.result(job.id!);
    assert.equal(result.executed, true);
    assert.equal(result.nestedCandidate, true);
    machines.exec = async () => ({
      code: 0,
      stdout: 'CPU=flags : fpu hypervisor\nKVM=no\nKERNEL=6.18.3\n',
      stderr: '',
    });
    const unsupported = observation.parse(
      await features.action(id, { action: 'check', featureId: 'nested-virtualization' }),
    );
    assert.equal(unsupported.ready, true);
    assert.equal(unsupported.nestedCandidate, false);
    assert.equal(unsupported.cpuExtension, null);
    assert.equal(unsupported.kvmDevice, false);
    await features.close();
    const restored = new NextFeatures(machines, workspaces);
    try {
      assert.equal((await restored.view(id)).executions.length, 4);
      assert.equal((await restored.view(id)).executions[0].result.nestedCandidate, false);
    } finally {
      await restored.close();
    }
  } finally {
    await features.close();
  }
});
