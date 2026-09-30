import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';
import type { HaFailureMonitor } from '../server/ha-failure-monitor.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { SnapshotReplications } from '../server/snapshot-replications.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-ha-local-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { HaLocalFailovers } = await import('../server/ha-local-failovers.ts');
const { createSchema } = await import('../server/model.ts');
after(async () => {
  const path = await realpath(root);
  if (!basename(path).startsWith('sakura-ha-local-') || resolve(path) === resolve(tmpdir()))
    throw new Error('unsafe local HA cleanup');
  await rm(path, { recursive: true, force: true });
});

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
  await assert.rejects(machines.start(targetId), { code: 'HA_REPLICA_STANDBY' });
  await assert.rejects(machines.startHaReplica(targetId, { sourceHostId, transferId,
    sourceVmId: sourceId, snapshotId, sha256: 'b'.repeat(64) }),
  { code: 'HA_REPLICA_STANDBY' });
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

test('a witness-enrolled source needs serialized disarm before local fencing and every pending retry', async () => {
  const machines = new Machines({ runtime: { close: async () => {} } } as Engine);
  await machines.init();
  const sourceId = randomUUID(), targetId = randomUUID(), sourceHostId = randomUUID();
  const targetHostId = randomUUID(), snapshotId = randomUUID(), transferId = randomUUID(), peerId = randomUUID();
  const sha256 = 'c'.repeat(64), now = new Date().toISOString();
  machines.records.set(sourceId, { ...createSchema.parse({ name: 'witness-arbitration' }),
    id: sourceId, createdAt: now, snapshots: [{ id: snapshotId, name: 'standby', createdAt: now }],
    lastError: 'QEMU exited unexpectedly', haWitnessEnrollment: { targetHostId,
      failureThreshold: 3, registeredAt: now } });
  const calls: string[] = [];
  let targetStatus: 'stopped' | 'starting' | 'running' = 'stopped';
  let checkGate: Promise<void> | null = null, checkEntered = () => {};
  const peers = {
    score: async () => ({ candidates: [
      { id: sourceHostId, source: 'local', status: { platform: 'win32', arch: 'x64' } },
      { id: targetHostId, source: 'peer', name: 'standby', eligible: true, reasons: [],
        observedAt: Date.now(), status: { platform: 'win32', arch: 'x64' } },
    ] }),
    view: () => ({ outbound: [{ id: peerId, remoteId: targetHostId }] }),
    importStatus: async () => ({ id: targetId, sha256, sourceVmId: sourceId, snapshotId }),
    checkReplicaActivation: async () => {
      calls.push('target-check');
      if (checkGate && machines.get(sourceId).haPromotion) { checkEntered(); await checkGate; }
      return { ready: true, id: targetId, status: targetStatus };
    },
    activateReplica: async () => {
      const saved = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
      assert.equal(saved.find((vm: { id: string }) => vm.id === sourceId).haPromotion.transferId, transferId);
      calls.push('activate'); targetStatus = 'starting'; return { id: targetId, status: targetStatus };
    },
  } as unknown as HostPeers;
  const monitor = { view: () => ({ suspected: true }) } as unknown as HaFailureMonitor;
  const replications = { view: () => ({ entries: [{ vmId: sourceId, peerId, snapshotId,
    transferId, remoteVmId: targetId, sha256, status: 'replicated', createdAt: now, updatedAt: now }] })
  } as unknown as SnapshotReplications;
  const policy = { enabled: true, options: { targetHostId, failureThreshold: 3,
    autoProcessFailover: true, autoHostFailover: true } };
  let failover = new HaLocalFailovers(machines, monitor, peers, replications,
    async () => ({ [sourceId]: policy }));
  try {
    await failover.init();
    machines.live.set(sourceId, { status: 'running' } as never); machines.emit('change');
    machines.live.delete(sourceId);
    await failover.sample();
    assert.match(failover.view(sourceId).error || '', /见证撤防校验不可用/);
    assert.equal(machines.get(sourceId).haPromotion, undefined);
    assert.equal(calls.includes('activate'), false);
    failover.setWitnessDisarmGuard(async () => { throw new Error('witness already fencing'); });
    await failover.sample();
    assert.match(failover.view(sourceId).error || '', /already fencing/);
    assert.equal(machines.get(sourceId).haPromotion, undefined);
    assert.equal(calls.includes('activate'), false);
    let releaseDisarm = () => {}, disarmEntered = () => {};
    let disarmGate = new Promise<void>((done) => { releaseDisarm = done; });
    let entered = new Promise<void>((done) => { disarmEntered = done; });
    failover.setWitnessDisarmGuard(async () => { disarmEntered(); await disarmGate; });
    const policyChanging = failover.sample();
    await entered;
    policy.enabled = false;
    releaseDisarm();
    await policyChanging;
    assert.match(failover.view(sourceId).error || '', /策略已变化/);
    assert.equal(machines.get(sourceId).haPromotion, undefined,
      'a strategy disabled while withdrawal waits cannot persist a local fence');
    assert.equal(calls.includes('activate'), false);
    policy.enabled = true;
    failover.setWitnessDisarmGuard(async (id, threshold) => {
      assert.equal(id, sourceId); assert.equal(threshold, 3);
      assert.equal(machines.get(sourceId).haPromotion, undefined);
      calls.push('disarm');
    });
    calls.length = 0;
    await failover.sample();
    assert.equal(calls.includes('disarm'), true);
    assert.ok(calls.indexOf('disarm') < calls.indexOf('activate'));
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    assert.equal(calls.filter((call) => call === 'activate').length, 1);
    let releaseCheck = () => {};
    checkGate = new Promise<void>((done) => { releaseCheck = done; });
    const checked = new Promise<void>((done) => { checkEntered = done; });
    failover.setWitnessDisarmGuard(async () => { calls.push('check-disarm'); });
    targetStatus = 'stopped';
    calls.length = 0;
    const checking = failover.sample();
    await checked;
    policy.options.autoProcessFailover = false;
    releaseCheck();
    await checking;
    assert.equal(calls.includes('activate'), false,
      'a policy disabled during slow target inspection cannot start the standby');
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    assert.match(machines.get(sourceId).haPromotion?.error || '', /策略已变化/);
    policy.options.autoProcessFailover = true;
    checkGate = null;
    targetStatus = 'starting';
    failover.setWitnessDisarmGuard(async () => { throw new Error('witness unavailable during retry'); });
    calls.length = 0;
    await failover.sample();
    assert.equal(calls.includes('activate'), false);
    assert.equal(calls.includes('target-check'), false,
      'an existing pending local fence cannot bypass the witness on a new run');
    assert.match(machines.get(sourceId).haPromotion?.error || '', /unavailable during retry/);
    disarmGate = new Promise<void>((done) => { releaseDisarm = done; });
    entered = new Promise<void>((done) => { disarmEntered = done; });
    failover.setWitnessDisarmGuard(async () => { disarmEntered(); await disarmGate; });
    const changingTarget = failover.sample();
    await entered;
    policy.options.targetHostId = randomUUID();
    releaseDisarm();
    await changingTarget;
    assert.equal(calls.includes('target-check'), false,
      'pending retries recheck the durable target after witness withdrawal');
    assert.match(machines.get(sourceId).haPromotion?.error || '', /策略已变化/);
    policy.options.targetHostId = targetHostId;
    disarmGate = new Promise<void>((done) => { releaseDisarm = done; });
    entered = new Promise<void>((done) => { disarmEntered = done; });
    const stopping = failover.sample();
    await entered;
    const stopped = failover.close();
    releaseDisarm();
    await Promise.all([stopping, stopped]);
    assert.equal(calls.includes('target-check'), false,
      'service shutdown during withdrawal cannot touch the target');
    assert.equal(machines.get(sourceId).haPromotion?.status, 'fenced');
    failover = new HaLocalFailovers(machines, monitor, peers, replications,
      async () => ({ [sourceId]: policy }));
    failover.setWitnessDisarmGuard(async () => { calls.push('retry-disarm'); });
    targetStatus = 'running';
    await failover.init();
    assert.equal(calls[0], 'retry-disarm');
    assert.equal(machines.get(sourceId).haPromotion?.status, 'accepted');
  } finally { await failover.close(); machines.live.clear(); await machines.close(); }
});
