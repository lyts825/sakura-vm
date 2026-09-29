import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Engine } from '../server/runtime.ts';
import type { HaFailureMonitor } from '../server/ha-failure-monitor.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { SnapshotReplications } from '../server/snapshot-replications.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-ha-local-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { HaLocalFailovers } = await import('../server/ha-local-failovers.ts');
const { createSchema } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

test('process-only takeover fences source before promotion and retires target before rejoin', async () => {
  const engine = { runtime: { close: async () => {} } } as Engine;
  const machines = new Machines(engine);
  await machines.init();
  const sourceId = randomUUID(), targetId = randomUUID();
  const snapshotId = randomUUID(), transferId = randomUUID();
  const peerId = randomUUID(), targetHostId = randomUUID(), sourceHostId = randomUUID();
  const sha256 = 'a'.repeat(64), now = new Date().toISOString();
  machines.records.set(sourceId, { ...createSchema.parse({ name: 'source' }),
    id: sourceId, createdAt: now, snapshots: [{ id: snapshotId, name: 'standby',
      createdAt: now }], lastError: 'QEMU exited unexpectedly' });
  machines.records.set(targetId, { ...createSchema.parse({ name: 'standby' }),
    id: targetId, createdAt: now, snapshots: [], migrationOrigin: {
      sourceHostId, transferId, targetName: 'standby', sourceVmId: sourceId,
      snapshotId, diskSha256: sha256,
    } });
  let suspected = true, starts = 0, retires = 0, failStartOnce = true;
  let targetStatus: 'stopped' | 'starting' | 'running' = 'stopped';
  const monitor = {
    view: () => ({ suspected }),
    reconfigure: async () => { suspected = false; },
  } as unknown as HaFailureMonitor;
  const peers = {
    score: async () => ({ candidates: [
      { id: sourceHostId, source: 'local', status: { platform: 'win32', arch: 'x64' } },
      { id: targetHostId, source: 'peer', name: 'standby', eligible: true,
        reasons: [], observedAt: Date.now(),
        status: { platform: 'win32', arch: 'x64' } },
    ] }),
    view: () => ({ outbound: [{ id: peerId, remoteId: targetHostId }] }),
    importStatus: async () => ({ id: targetId, sha256, sourceVmId: sourceId, snapshotId }),
    checkReplicaActivation: async () => ({ ready: true, id: targetId, status: targetStatus }),
    activateReplica: async () => {
      const saved = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
      assert.equal(saved.find((vm: { id: string }) => vm.id === sourceId).haPromotion.transferId,
        transferId);
      starts++;
      if (failStartOnce) {
        failStartOnce = false;
        throw new Error('standby unavailable');
      }
      targetStatus = 'starting';
      return { id: targetId, status: targetStatus };
    },
    retireReplica: async () => {
      retires++;
      await machines.retireHaReplica(targetId, { sourceHostId, transferId,
        sourceVmId: sourceId, snapshotId, sha256 });
      return { id: targetId, retired: true };
    },
  } as unknown as HostPeers;
  const replications = { view: () => ({ entries: [{ vmId: sourceId, peerId,
    snapshotId, transferId, remoteVmId: targetId, sha256, status: 'replicated',
    createdAt: now, updatedAt: now }] }) } as unknown as SnapshotReplications;
  const policy = { enabled: true, options: { targetHostId, autoProcessFailover: true } };
  const failover = new HaLocalFailovers(machines, monitor, peers, replications,
    async () => ({ [sourceId]: policy }));
  try {
    await failover.init();
    assert.equal(starts, 0, 'persisted suspicion alone is not process-exit evidence');
    machines.live.set(sourceId, { status: 'running' } as never);
    machines.emit('change');
    machines.live.delete(sourceId);
    await failover.sample();
    assert.equal(starts, 1);
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    await assert.rejects(machines.start(sourceId), { code: 'HA_SOURCE_FENCED' });
    await failover.sample();
    assert.equal(starts, 2);
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    assert.equal(machines.get(sourceId).haPromotion?.error, undefined);
    await failover.sample();
    assert.equal(starts, 2, 'a starting standby is observed rather than started again');
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    const waiting = new Machines(engine);
    await waiting.init();
    try {
      assert.equal(waiting.get(sourceId).haPromotion?.status, 'fenced');
      await assert.rejects(waiting.start(sourceId), { code: 'HA_SOURCE_FENCED' });
    } finally { await waiting.close(); }
    targetStatus = 'running';
    await failover.sample();
    assert.equal(machines.get(sourceId).haPromotion?.status, 'accepted');
    await assert.rejects(machines.start(sourceId), { code: 'HA_SOURCE_FENCED' });
    const reopened = new Machines(engine);
    await reopened.init();
    try {
      await assert.rejects(reopened.start(sourceId), { code: 'HA_SOURCE_FENCED' });
    } finally { await reopened.close(); }
    machines.live.set(targetId, { status: 'running' } as never);
    await assert.rejects(failover.rejoin(sourceId, true), /请先停止/);
    assert.ok(machines.get(sourceId).haPromotion);
    machines.live.delete(targetId);
    await assert.rejects(failover.rejoin(sourceId, false), /请先回迁/);
    assert.equal((await failover.rejoin(sourceId, true)).executed, true);
    assert.equal(retires, 2);
    assert.equal(machines.get(sourceId).haPromotion, undefined);
    assert.ok(machines.get(targetId).haRetirement);
    await assert.rejects(machines.start(targetId), { code: 'HA_REPLICA_RETIRED' });
    const final = new Machines(engine);
    await final.init();
    try {
      assert.equal(final.get(sourceId).haPromotion, undefined);
      await assert.rejects(final.start(targetId), { code: 'HA_REPLICA_RETIRED' });
    } finally { await final.close(); }
  } finally {
    await failover.close();
    machines.live.clear();
    await machines.close();
  }
});
