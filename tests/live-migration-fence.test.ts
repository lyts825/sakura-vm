/**
 * 回归范围（完整情景见下方用例与断言）：
 * - migration fence is written only at QEMU switchover and blocks source restart after recovery
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-fence-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(async () => {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-fence-'))
    throw new Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
});

for (const stopMode of ['ordinary', 'completion', 'incident'] as const)
test(`manual run transitions honor a fence and ${stopMode} stop persists native exit for host restart`, async () => {
  const engine = { whpxAvailable: false, runtime: { close: async () => {} },
    run: async (_tool: string, _args: string[], options: { signal: AbortSignal }) => {
      await new Promise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  } as unknown as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID(), now = new Date().toISOString();
  await mkdir(vmDir(id));
  await writeFile(join(vmDir(id), 'disk.qcow2'), 'synthetic disk');
  machines.records.set(id, { ...createSchema.parse({ name: `source-${id.slice(0, 8)}` }),
    id, createdAt: now, snapshots: [], liveMigrationOrigin: {
      sourceHostId: randomUUID(), sourceVmId: randomUUID(), transferId: randomUUID(),
      status: 'prepared', createdAt: now, updatedAt: now,
    } });
  let gracefulExecutions = 0;
  machines.exec = async () => { gracefulExecutions++; throw new Error('fenced source must not execute'); };
  try {
    await machines.startIncoming(id);
    const live = machines.live.get(id)!;
    live.incoming = false;
    live.status = 'running';
    delete machines.get(id).liveMigrationOrigin;
    const fence = await machines.fenceForLiveMigration(id, {
      targetHostId: randomUUID(), targetVmId: randomUUID(), transferId: randomUUID(),
      peerId: randomUUID(), sourceHostId: randomUUID(), sessionId: randomUUID(), projectsDigest: 'a'.repeat(64),
    }, async (_port, command) => command === 'query-status' ? { running: false } : { status: 'pre-switchover' });
    await assert.rejects(machines.suspend(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    await assert.rejects(machines.memorySnapshot(id, 'fenced'), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    await assert.rejects(machines.restoreMemory(id, randomUUID()), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    live.status = 'paused';
    await assert.rejects(machines.resume(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    if (stopMode === 'ordinary') await machines.stop(id);
    else if (stopMode === 'completion') await machines.stopLiveMigrationSource(id, fence);
    else {
      await machines.setIncidentLockdown(id, true);
      await machines.setIncidentLockdown(id, false);
      await assert.rejects(machines.start(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    }
    assert.equal(gracefulExecutions, 0);
    assert.equal(machines.live.has(id), false);
    assert.equal(machines.get(id).liveMigrationFence?.sourceStopped?.sourceProcessId, fence.sourceProcessId);
    const restored = new Machines(engine, fakeVmNetwork);
    await restored.init();
    try {
      const durable = restored.get(id).liveMigrationFence!;
      assert.equal(restored.canConfirmLiveMigrationCompletion(id, durable), true);
      await assert.rejects(restored.start(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
      const noExit = { ...durable, sourceStopped: undefined };
      restored.get(id).liveMigrationFence = noExit;
      assert.equal(restored.canConfirmLiveMigrationCompletion(id, noExit), false);
      await assert.rejects(restored.stopLiveMigrationSource(id, noExit), { code: 'LIVE_MIGRATION_SOURCE_UNCONFIRMED' });
    } finally { await restored.close(); }
  } finally { await machines.close(); }
});

test('migration fence is written only at QEMU switchover and blocks source restart after recovery', async () => {
  const engine = { runtime: { close: async () => {} } } as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
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
    const restored = new Machines(engine, fakeVmNetwork);
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
