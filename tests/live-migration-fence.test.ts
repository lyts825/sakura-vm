import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-fence-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema } = await import('../server/model.ts');
after(async () => {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-fence-'))
    throw new Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
});

test('migration fence is written only at QEMU switchover and blocks source restart after recovery', async () => {
  const engine = { runtime: { close: async () => {} } } as Engine;
  const machines = new Machines(engine);
  await machines.init();
  const id = randomUUID();
  const now = new Date().toISOString();
  machines.records.set(id, { ...createSchema.parse({ name: 'source' }),
    id, createdAt: now, snapshots: [] });
  machines.live.set(id, { status: 'running', qmpPort: 7339 } as never);
  const identity = { targetHostId: randomUUID(), targetVmId: randomUUID(),
    transferId: randomUUID() };
  let state = { running: true }, migration = { status: 'active' };
  const query = async (_port: number, command: string) =>
    command === 'query-status' ? state : migration;
  try {
    await assert.rejects(machines.fenceForLiveMigration(id, identity, query), /尚未在迁移切换点暂停/);
    assert.equal(machines.get(id).liveMigrationFence, undefined);
    state = { running: false };
    migration = { status: 'pre-switchover' };
    const fence = await machines.fenceForLiveMigration(id, identity, query);
    assert.equal(fence.transferId, identity.transferId);
    const saved = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
    assert.equal(saved.find((vm: { id: string }) => vm.id === id).liveMigrationFence.transferId,
      identity.transferId);
    assert.deepEqual(await machines.fenceForLiveMigration(id, identity, query), fence);
    await assert.rejects(machines.fenceForLiveMigration(id, {
      ...identity, transferId: randomUUID(),
    }, query), /其他在线迁移栅栏/);
    await assert.rejects(machines.start(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    machines.live.delete(id);
    await assert.rejects(machines.delete(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    const restored = new Machines(engine);
    await restored.init();
    try {
      assert.equal(restored.get(id).liveMigrationFence?.transferId, identity.transferId);
      await assert.rejects(restored.start(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    } finally { await restored.close(); }
  } finally {
    machines.live.delete(id);
    await machines.close();
  }
});
