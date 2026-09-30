import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHostImportReceiver } from '../server/host-import-receiver.ts';
import { createSchema, type VMRecord, type VMStatus } from '../server/model.ts';
import type { Machines } from '../server/machines.ts';
import type { Bundles } from '../server/bundles.ts';

function fixture() {
  const input = { requesterId: randomUUID(), transferId: randomUUID(), remoteVmId: randomUUID(),
    sourceVmId: randomUUID(), snapshotId: randomUUID(), sha256: 'a'.repeat(64) };
  const vm: VMRecord = { ...createSchema.parse({ name: 'standby' }), id: input.remoteVmId,
    createdAt: new Date().toISOString(), snapshots: [], migrationOrigin: {
      sourceHostId: input.requesterId, transferId: input.transferId, targetName: 'standby',
      diskSha256: input.sha256, sourceVmId: input.sourceVmId, snapshotId: input.snapshotId } };
  let status: VMStatus = 'stopped', sessionLocked = false, incidentLocked = false,
    blocked = false, enabled = true;
  const starts: unknown[] = [], retirements: unknown[] = [];
  const machines = { records: new Map([[vm.id, vm]]), get: () => vm, state: () => status,
    requireUnlocked: () => { if (incidentLocked) throw new Error('incident locked'); },
    start: async () => { starts.push('ordinary'); status = 'starting'; },
    startHaReplica: async (id: string, identity: unknown) => {
      starts.push({ id, identity }); status = 'starting';
    },
    retireHaReplica: async (id: string, identity: unknown) => { retirements.push({ id, identity }); },
  } as unknown as Machines;
  const receiver = createHostImportReceiver(machines, {
    bundles: () => enabled ? {} as Bundles : undefined,
    migrationBlocked: () => blocked,
    requireSessionUnlocked: () => { if (sessionLocked) throw new Error('session locked'); },
  });
  return { input, receiver, vm, starts, retirements, setStatus: (value: VMStatus) => { status = value; },
    lockSession: () => { sessionLocked = true; }, lockIncident: () => { incidentLocked = true; },
    block: () => { blocked = true; }, disable: () => { enabled = false; } };
}

test('HA activation works while the web session is locked and passes the complete replica identity', async () => {
  const f = fixture(); f.lockSession();
  assert.equal((await f.receiver.inspectReplicaActivation!(f.input)).status, 'stopped');
  assert.equal((await f.receiver.activateReplica!(f.input)).status, 'starting');
  assert.deepEqual(f.starts, [{ id: f.input.remoteVmId, identity: {
    sourceHostId: f.input.requesterId, transferId: f.input.transferId,
    sourceVmId: f.input.sourceVmId, snapshotId: f.input.snapshotId, sha256: f.input.sha256 } }]);
  await f.receiver.activateReplica!(f.input);
  assert.equal(f.starts.length, 1, 'a repeated request cannot launch a second guest');
  await assert.rejects(f.receiver.activate!(f.input), /session locked/);
});

test('wrong origins, checksums, retired replicas and non-runnable states never launch', async () => {
  for (const key of ['requesterId', 'transferId', 'sourceVmId', 'snapshotId', 'sha256'] as const) {
    const f = fixture();
    await assert.rejects(f.receiver.activateReplica!({ ...f.input,
      [key]: key === 'sha256' ? 'b'.repeat(64) : randomUUID() }), /身份或快照校验值/);
    assert.equal(f.starts.length, 0);
  }
  for (const status of ['paused', 'stopping', 'error'] as const) {
    const f = fixture(); f.setStatus(status);
    await assert.rejects(f.receiver.activateReplica!(f.input), /需要人工复核/);
    assert.equal(f.starts.length, 0);
  }
  const retired = fixture();
  retired.vm.haRetirement = { sourceHostId: retired.input.requesterId,
    transferId: retired.input.transferId, sourceVmId: retired.input.sourceVmId,
    snapshotId: retired.input.snapshotId, sha256: retired.input.sha256,
    retiredAt: new Date().toISOString() };
  await assert.rejects(retired.receiver.activateReplica!(retired.input), /退出接管/);
  assert.equal(retired.starts.length, 0);
});

test('maintenance, incident locks and missing plugins reject HA starts and retirement', async () => {
  for (const guard of ['block', 'lockIncident', 'disable'] as const) {
    const f = fixture(); f[guard]();
    await assert.rejects(f.receiver.activateReplica!(f.input));
    await assert.rejects(f.receiver.retireReplica!(f.input));
    assert.equal(f.starts.length, 0); assert.equal(f.retirements.length, 0);
  }
});

test('snapshot receipts cannot use ordinary migration activation and retirement preserves identity', async () => {
  const f = fixture();
  const receipt = await f.receiver.status(f.input);
  assert.deepEqual(receipt, { id: f.vm.id, name: 'standby', sha256: f.input.sha256,
    sourceVmId: f.input.sourceVmId, snapshotId: f.input.snapshotId });
  assert.equal(await f.receiver.status({ ...f.input, requesterId: randomUUID() }), null);
  await assert.rejects(f.receiver.activate!(f.input), /快照复制副本不能/);
  f.lockSession();
  assert.deepEqual(await f.receiver.retireReplica!(f.input), { id: f.vm.id, retired: true });
  assert.deepEqual(f.retirements, [{ id: f.input.remoteVmId, identity: {
    sourceHostId: f.input.requesterId, transferId: f.input.transferId,
    sourceVmId: f.input.sourceVmId, snapshotId: f.input.snapshotId, sha256: f.input.sha256 } }]);
});
