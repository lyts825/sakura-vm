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
  const heartbeats: Array<{ plan?: { remoteVmId: string } | null }> = [];
  let witnessArmed = false, scoreGate: Promise<void> | null = null;
  let scoreEntered = () => {};
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
    score: async () => {
      if (scoreGate) { scoreEntered(); await scoreGate; }
      return { candidates: [
      { source: 'local', id: sourceHostId, status: { platform: 'win32', arch: 'x64' } },
      { source: 'peer', id: targetHostId, name: 'target', eligible: true,
        reasons: [], observedAt: Date.now(), status: { platform: 'win32', arch } },
      ] };
    },
    importStatus: async () => ({ id: remoteVmId, sha256, sourceVmId: id, snapshotId }),
    checkReplicaActivation: async () => ({ ready: true, id: remoteVmId, status: 'stopped' }),
  } as unknown as HostPeers;
  const replications = { view: () => ({ entries: [{ vmId: id, peerId, snapshotId,
    transferId, remoteVmId, sha256, status: 'replicated', createdAt: at,
    updatedAt: at }] }) } as unknown as SnapshotReplications;
  const client = {
    heartbeat: async (input: { plan?: { remoteVmId: string } | null }) => {
      heartbeats.push(input);
      if ('plan' in input) witnessArmed = !!input.plan;
      return { armed: witnessArmed };
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
    let releaseScore = () => {};
    scoreGate = new Promise<void>((resolve) => { releaseScore = resolve; });
    const entered = new Promise<void>((resolve) => { scoreEntered = resolve; });
    const slowScan = failover.sample();
    await entered;
    assert.equal(Object.hasOwn(heartbeats.at(-1)!, 'plan'), false,
      'source liveness is refreshed without disarming during slow peer validation');
    assert.equal(witnessArmed, true);
    releaseScore();
    await slowScan;
    scoreGate = null;
    const disarmStart = heartbeats.length;
    scoreGate = new Promise<void>((resolve) => { releaseScore = resolve; });
    const rechecking = new Promise<void>((resolve) => { scoreEntered = resolve; });
    const validating = failover.sample();
    await rechecking;
    state = 'stopped';
    let disarmFinished = false;
    const withdrawing = failover.disarm(id, 3).then(() => { disarmFinished = true; });
    await Promise.resolve();
    assert.equal(disarmFinished, false, 'withdrawal waits for the earlier peer scan');
    releaseScore();
    await Promise.all([validating, withdrawing]);
    scoreGate = null;
    assert.equal(witnessArmed, false);
    assert.equal(failover.view(id).armed, false);
    assert.equal(heartbeats.slice(disarmStart).some((item) => !!item.plan), false,
      'a source that exited during validation cannot publish the old plan');
    state = 'running';
    await failover.sample();
    assert.equal(witnessArmed, true);
    const fencingStart = heartbeats.length;
    scoreGate = new Promise<void>((resolve) => { releaseScore = resolve; });
    const fencingEntered = new Promise<void>((resolve) => { scoreEntered = resolve; });
    const staleScan = failover.sample();
    await fencingEntered;
    Object.assign(vm, { haPromotion: { status: 'fenced' } });
    releaseScore();
    await staleScan;
    scoreGate = null;
    assert.equal(witnessArmed, false);
    assert.equal(heartbeats.slice(fencingStart).some((item) => !!item.plan), false,
      'a local fence established during validation cannot rearm the witness');
    Reflect.deleteProperty(vm, 'haPromotion');
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
