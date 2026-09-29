import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HaHostFailover } from '../server/ha-host-failover.ts';
import type { HaWitnessClient } from '../server/ha-witness-client.ts';
import type { Machines } from '../server/machines.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { SnapshotReplications } from '../server/snapshot-replications.ts';

test('source heartbeat arms only a verified compatible standby and start checks witness even after policy removal', async () => {
  const sourceHostId = randomUUID(), id = randomUUID(), targetHostId = randomUUID();
  const remoteVmId = randomUUID(), snapshotId = randomUUID(), transferId = randomUUID();
  const peerId = randomUUID(), sha256 = 'a'.repeat(64), at = new Date().toISOString();
  let state: 'running' | 'stopped' = 'running', arch = 'x64', policyEnabled = true;
  const heartbeats: Array<{ plan: { remoteVmId: string } | null }> = [];
  let starts = 0;
  const vm = { id, cpus: 2, memoryMiB: 1024,
    snapshots: [{ id: snapshotId, createdAt: at }],
    haWitnessEnrollment: { targetHostId, failureThreshold: 3, registeredAt: at } };
  const machines = {
    records: new Map([[id, vm]]), get: () => vm, state: () => state, live: new Map(),
    requireUnlocked: () => {}, requireStopped: () => {},
  } as unknown as Machines;
  const peers = {
    view: () => ({ hostId: sourceHostId,
      outbound: [{ id: peerId, remoteId: targetHostId }] }),
    score: async () => ({ candidates: [
      { source: 'local', id: sourceHostId, status: { platform: 'win32', arch: 'x64' } },
      { source: 'peer', id: targetHostId, name: 'target', eligible: true,
        reasons: [], observedAt: Date.now(), status: { platform: 'win32', arch } },
    ] }),
    importStatus: async () => ({ id: remoteVmId, sha256, sourceVmId: id, snapshotId }),
    checkReplicaActivation: async () => ({ ready: true, id: remoteVmId, status: 'stopped' }),
  } as unknown as HostPeers;
  const replications = { view: () => ({ entries: [{ vmId: id, peerId, snapshotId,
    transferId, remoteVmId, sha256, status: 'replicated', createdAt: at,
    updatedAt: at }] }) } as unknown as SnapshotReplications;
  const client = {
    heartbeat: async (input: { plan: { remoteVmId: string } | null }) => {
      heartbeats.push(input);
      return { armed: !!input.plan };
    },
    authorizeStart: async () => { starts++; },
  } as unknown as HaWitnessClient;
  const policy = { enabled: true, options: { targetHostId,
    failureThreshold: 3, maxReplicaAgeMinutes: 60, autoHostFailover: true } };
  const failover = new HaHostFailover(machines, peers, replications,
    async () => policyEnabled ? { [id]: policy } : {}, client);
  try {
    await failover.sample();
    assert.equal(heartbeats.at(-1)?.plan?.remoteVmId, remoteVmId);
    assert.equal(failover.view(id).armed, true);
    arch = 'arm64';
    await failover.sample();
    assert.equal(heartbeats.at(-1)?.plan, null, 'platform mismatch disarms witness');
    arch = 'x64';
    state = 'stopped';
    await failover.sample();
    assert.equal(heartbeats.at(-1)?.plan, null, 'planned stop disarms witness');
    policyEnabled = false;
    await failover.authorizeStart(id);
    assert.equal(starts, 1, 'persistent enrollment still requires witness');
  } finally {
    await failover.close();
    assert.equal(heartbeats.at(-1)?.plan, null, 'planned service close disarms witness');
  }
});
