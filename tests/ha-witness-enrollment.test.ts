import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-ha-enrollment-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema } = await import('../server/model.ts');
const engine = { runtime: { close: async () => {} } } as Engine;

test('a durable witness enrollment blocks ordinary starts even without the HA plugin', async () => {
  const machines = new Machines(engine);
  const id = randomUUID(), targetHostId = randomUUID();
  try {
    await machines.init();
    machines.records.set(id, { ...createSchema.parse({ name: 'witness-source' }),
      id, createdAt: new Date().toISOString(), snapshots: [] });
    await machines.enrollHaWitness(id, targetHostId, 3);
    await assert.rejects(machines.start(id), { code: 'HA_WITNESS_UNAVAILABLE' });
    await assert.rejects(machines.delete(id), { code: 'HA_WITNESS_ENROLLED' });
    const reopened = new Machines(engine);
    await reopened.init();
    try {
      assert.equal(reopened.get(id).haWitnessEnrollment?.targetHostId, targetHostId);
      await assert.rejects(reopened.start(id), { code: 'HA_WITNESS_UNAVAILABLE' });
      let checked = false;
      reopened.setHaStartGuard(async () => {
        checked = true;
        throw new Error('witness rejects a promoted source');
      });
      await assert.rejects(reopened.start(id), /witness rejects/);
      assert.equal(checked, true);
      await reopened.releaseHaWitness(id, targetHostId);
      assert.equal(reopened.get(id).haWitnessEnrollment, undefined);
    } finally { await reopened.close(); }
  } finally {
    await machines.close();
    const path = await realpath(root);
    if (!basename(path).startsWith('sakura-ha-enrollment-') ||
        resolve(path) === resolve(tmpdir())) throw new Error('unsafe enrollment cleanup');
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
