import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { checkHaFailover, haFailoverOptions } from '../server/ha-failover.ts';
import type { Machines } from '../server/machines.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { SnapshotReplications } from '../server/snapshot-replications.ts';

const vmId = randomUUID(), snapshotId = randomUUID(), remoteVmId = randomUUID();
const peerId = randomUUID(), targetHostId = randomUUID(), transferId = randomUUID();
const machines = (snapshotAt: string, source: 'running' | 'error' = 'running') => ({
  get: () => ({ cpus: 2, memoryMiB: 1024,
    snapshots: [{ id: snapshotId, createdAt: snapshotAt }] }),
  state: () => source,
  live: new Map(),
}) as unknown as Machines;
const peers = (eligible = true) => ({
  score: async () => ({ candidates: [
    { id: randomUUID(), source: 'local', name: 'source', eligible: true,
      status: { platform: 'win32', arch: 'x64' } },
    { id: targetHostId, source: 'peer', name: 'standby', eligible,
      status: { platform: 'win32', arch: 'x64' },
      reasons: eligible ? [] : ['空闲内存不足'], observedAt: Date.now() },
  ] }),
  view: () => ({ outbound: [{ id: peerId, remoteId: targetHostId }] }),
  importStatus: async () => ({ id: remoteVmId, sha256: 'a'.repeat(64),
    sourceVmId: vmId, snapshotId }),
}) as unknown as HostPeers;
const replications = () => ({ view: () => ({ entries: [{
  vmId, peerId, snapshotId, transferId, remoteVmId, sha256: 'a'.repeat(64),
  status: 'replicated', createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}] }) }) as unknown as SnapshotReplications;

test('failover policy accepts bounded health settings and rejects unknown parameters', () => {
  assert.deepEqual(haFailoverOptions.parse({ targetHostId }), {
    targetHostId, failureThreshold: 3, maxReplicaAgeMinutes: 1440,
    autoProcessFailover: false,
  });
  assert.equal(haFailoverOptions.safeParse({ targetHostId, failureThreshold: 1 }).success, false);
  assert.equal(haFailoverOptions.safeParse({ targetHostId, command: 'start' }).success, false);
});

test('failover health check identifies a fresh verified replica without claiming safe takeover', async () => {
  const result = await checkHaFailover(machines(new Date().toISOString()), peers(),
    replications(), vmId, { targetHostId }, true);
  assert.equal(result.ready, false);
  assert.equal(result.executed, false);
  assert.equal(result.target?.hostId, targetHostId);
  assert.equal(result.replica?.remoteVmId, remoteVmId);
  assert.equal(result.replica?.receiptVerified, true);
  assert.ok(result.blockers.some((item) => item.includes('栅栏')));
  assert.ok(result.blockers.some((item) => item.includes('流量切换')));
});

test('fresh verified replica can pass the local process-only preflight after QEMU exits', async () => {
  const unevidenced = await checkHaFailover(machines(new Date().toISOString(), 'error'),
    peers(), replications(), vmId, { targetHostId, autoProcessFailover: true }, true);
  assert.equal(unevidenced.localProcessReady, false);
  const result = await checkHaFailover(machines(new Date().toISOString(), 'error'),
    peers(), replications(), vmId, { targetHostId, autoProcessFailover: true }, true,
    undefined, true, true);
  assert.equal(result.ready, false);
  assert.equal(result.localProcessReady, true);
  assert.equal(result.replica?.transferId, transferId);
  assert.equal(result.replica?.peerId, peerId);
});

test('failover health check rejects a vanished standby receipt', async () => {
  const unavailable = { ...peers(), importStatus: async () => null } as unknown as HostPeers;
  const result = await checkHaFailover(machines(new Date().toISOString()), unavailable,
    replications(), vmId, { targetHostId }, true);
  assert.equal(result.replica?.receiptVerified, false);
  assert.ok(result.blockers.some((item) => item.includes('回执缺失')));
});

test('failover health check flags disabled, stale and undersized standby state', async () => {
  const old = new Date(Date.now() - 3 * 86400_000).toISOString();
  const result = await checkHaFailover(machines(old), peers(false), replications(),
    vmId, { targetHostId, maxReplicaAgeMinutes: 60 }, false);
  assert.ok(result.blockers.some((item) => item.includes('已禁用')));
  assert.ok(result.blockers.some((item) => item.includes('内存不足')));
  assert.ok(result.blockers.some((item) => item.includes('时效上限')));
});
