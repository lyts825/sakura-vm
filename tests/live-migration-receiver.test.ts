import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LiveMigrationReceiver } from '../server/live-migration-receiver.ts';
import type { Machines } from '../server/machines.ts';
import type { HostPeers } from '../server/host-peers.ts';

test('target completion binds the session and transfer, then permits idempotent readiness polling', async () => {
  const requesterId = randomUUID(), transferId = randomUUID();
  const targetVmId = randomUUID(), sessionId = randomUUID();
  const origin = { sourceHostId: requesterId, sourceVmId: randomUUID(),
    transferId, status: 'prepared', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString() };
  const vm = { id: targetVmId, liveMigrationOrigin: origin };
  let state: 'paused' | 'starting' | 'running' = 'paused';
  let completes = 0, closes = 0;
  const machines = {
    get: (id: string) => {
      if (id !== targetVmId) throw new Error('wrong target');
      return vm;
    },
    state: () => state,
    completeIncoming: async () => { completes++; origin.status = 'received'; state = 'starting'; },
  } as unknown as Machines;
  const peers = {
    matchesMigrationSession: (session: string, requester: string, target: string,
      transfer: string) => session === sessionId && requester === requesterId &&
        target === targetVmId && transfer === transferId,
    closeMigrationSession: () => { closes++; },
  } as unknown as HostPeers;
  const receiver = new LiveMigrationReceiver(machines, peers);
  assert.throws(() => receiver.status({ requesterId: randomUUID(), transferId, targetVmId }),
    /身份不匹配/);
  await assert.rejects(receiver.complete({ requesterId, transferId, targetVmId,
    sessionId: randomUUID() }), /会话与目标实例不匹配/);
  assert.equal(completes, 0);
  assert.deepEqual(await receiver.complete({ requesterId, transferId, targetVmId, sessionId }),
    { targetVmId, status: 'starting', originStatus: 'received' });
  assert.equal(completes, 1);
  assert.equal(closes, 1);
  assert.equal((await receiver.complete({ requesterId, transferId, targetVmId,
    sessionId })).originStatus, 'received');
  assert.equal(completes, 1);
  origin.status = 'ready';
  state = 'running';
  assert.deepEqual(receiver.status({ requesterId, transferId, targetVmId }),
    { targetVmId, status: 'running', originStatus: 'ready' });
});

test('target abort requires the original session and a still-prepared receiver', async () => {
  const requesterId = randomUUID(), transferId = randomUUID();
  const targetVmId = randomUUID(), sessionId = randomUUID();
  const origin = { sourceHostId: requesterId, transferId, status: 'prepared' };
  let closes = 0, stops = 0, deletes = 0;
  const machines = {
    get: () => ({ id: targetVmId, liveMigrationOrigin: origin }),
    state: () => 'stopped',
    live: new Map(),
    stop: async () => { stops++; },
    delete: async () => { deletes++; },
  } as unknown as Machines;
  const peers = {
    matchesMigrationSession: (session: string) => session === sessionId,
    closeMigrationSession: () => { closes++; },
  } as unknown as HostPeers;
  const receiver = new LiveMigrationReceiver(machines, peers);
  await assert.rejects(receiver.abort({ requesterId, transferId, targetVmId,
    sessionId: randomUUID(), sourceRunning: true }), /会话与目标实例不匹配/);
  assert.deepEqual([closes, stops, deletes], [0, 0, 0]);
  origin.status = 'received';
  await assert.rejects(receiver.abort({ requesterId, transferId, targetVmId,
    sessionId, sourceRunning: true }), /已接收迁移/);
  assert.deepEqual([closes, stops, deletes], [0, 0, 0]);
  origin.status = 'prepared';
  assert.deepEqual(await receiver.abort({ requesterId, transferId, targetVmId,
    sessionId, sourceRunning: true }), { targetVmId, aborted: true });
  assert.deepEqual([closes, stops, deletes], [1, 1, 1]);
});
