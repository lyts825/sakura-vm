import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { planLiveMigration } from '../server/live-migration.ts';
import type { Machines } from '../server/machines.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { qmp } from '../server/qmp.ts';

const vmId = randomUUID(), localId = randomUUID(), peerId = randomUUID();
const machines = {
  get: () => ({ cpus: 2, memoryMiB: 1024 }),
  state: () => 'running',
  live: new Map([[vmId, { qmpPort: 1234 }]]),
} as unknown as Machines;
const score = (arch = 'x64', eligible = true) => async () => ({ candidates: [
  { id: localId, source: 'local', name: 'local', eligible: true, reasons: [],
    status: { platform: 'win32', arch: 'x64' } },
  { id: peerId, source: 'peer', name: 'remote', eligible,
    reasons: eligible ? [] : ['空闲内存不足'], status: { platform: 'win32', arch } },
] }) as Awaited<ReturnType<HostPeers['score']>>;
const query = (status = 'none') => (async (_port: number, command: string) => {
  if (command === 'query-status') return { status: 'running', running: true };
  if (command === 'query-version') return { qemu: { major: 11, minor: 1, micro: 0 } };
  if (command === 'query-migrate') return { status };
  throw new Error('unexpected QMP query');
}) as typeof qmp;

test('online migration check selects a paired target but never claims a safe transfer exists', async () => {
  const result = await planLiveMigration(machines, score(), vmId, {}, undefined, query());
  assert.equal(result.targetHostId, peerId);
  assert.equal(result.ready, false);
  assert.equal(result.executed, false);
  assert.equal(result.planned, true);
  assert.equal(result.steps.length, 5);
  assert.ok(result.blockers.some((item) => item.includes('磁盘脏块同步')));
  assert.ok(result.blockers.some((item) => item.includes('切换栅栏')));
});

test('online migration check reports incompatible or busy targets and source migration activity', async () => {
  const result = await planLiveMigration(machines, score('arm64', false), vmId,
    { targetHostId: peerId }, undefined, query('active'));
  assert.ok(result.blockers.some((item) => item.includes('内存不足')));
  assert.ok(result.blockers.some((item) => item.includes('体系结构')));
  assert.ok(result.blockers.some((item) => item.includes('已存在迁移任务')));
  assert.equal(result.ready, false);
});

test('online migration check prefers a compatible target over a higher scored incompatible peer', async () => {
  const compatibleId = randomUUID();
  const withMixedPeers = async () => ({ candidates: [
    { id: localId, source: 'local', name: 'local', eligible: true, reasons: [],
      status: { platform: 'win32', arch: 'x64' } },
    { id: peerId, source: 'peer', name: 'incompatible', eligible: true, reasons: [],
      status: { platform: 'win32', arch: 'arm64' } },
    { id: compatibleId, source: 'peer', name: 'compatible', eligible: true, reasons: [],
      status: { platform: 'win32', arch: 'x64' } },
  ] }) as unknown as Awaited<ReturnType<HostPeers['score']>>;
  const result = await planLiveMigration(machines, withMixedPeers, vmId, {}, undefined, query());
  assert.equal(result.targetHostId, compatibleId);
  assert.equal(result.ready, false);
});

test('online migration check preserves a missing peer as a blocker', async () => {
  const missing = randomUUID();
  const result = await planLiveMigration(machines, score(), vmId,
    { targetHostId: missing }, undefined, query());
  assert.equal(result.targetHostId, missing);
  assert.ok(result.blockers.some((item) => item.includes('未配对')));
});
