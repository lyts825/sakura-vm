import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';
import type { Workspaces } from '../server/workspaces.ts';
import type { HaHostFailover } from '../server/ha-host-failover.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-ha-config-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { NextFeatures } = await import('../server/next-features.ts');
const { createSchema } = await import('../server/model.ts');
after(async () => {
  const path = await realpath(root);
  if (!basename(path).startsWith('sakura-ha-config-') ||
      resolve(path) === resolve(tmpdir())) throw new Error('unsafe HA configuration cleanup');
  await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('HA policy enrollment and revocation follow witness acknowledgments', async () => {
  const machines = new Machines({ runtime: { close: async () => {} } } as Engine);
  await machines.init();
  const id = randomUUID(), targetHostId = randomUUID();
  machines.records.set(id, { ...createSchema.parse({ name: 'ha-policy' }),
    id, createdAt: new Date().toISOString(), snapshots: [] });
  const workspaces = { projects: { current: () => 'default', key: () => id } } as unknown as Workspaces;
  const features = new NextFeatures(machines, workspaces);
  const disarmed: string[] = [];
  features.setHaHostFailover({
    configured: () => true,
    witnessStatus: async () => ({ configured: true, phase: 'source',
      targetHostId, failureThreshold: 3, armed: false }),
    disarm: async (_id: string, threshold: number) => { disarmed.push(`${_id}:${threshold}`); },
  } as unknown as HaHostFailover);
  try {
    await features.configure(id, { featureId: 'ha-failover', enabled: true,
      options: { targetHostId, failureThreshold: 3, autoHostFailover: true } });
    assert.equal(machines.get(id).haWitnessEnrollment?.targetHostId, targetHostId);
    const restored = new Machines({ runtime: { close: async () => {} } } as Engine);
    await restored.init();
    try { assert.equal(restored.get(id).haWitnessEnrollment?.failureThreshold, 3); }
    finally { await restored.close(); }
    await assert.rejects(features.configure(id, { featureId: 'ha-failover',
      enabled: true, options: { targetHostId: randomUUID(), failureThreshold: 3,
        autoHostFailover: true } }), /先关闭/);
    assert.deepEqual(disarmed, []);
    await features.configure(id, { featureId: 'ha-failover', enabled: false,
      options: { targetHostId, failureThreshold: 3, autoHostFailover: false } });
    assert.deepEqual(disarmed, [`${id}:3`]);
    assert.equal(machines.get(id).haWitnessEnrollment, undefined);
  } finally {
    await features.close();
    await machines.close();
  }
});
