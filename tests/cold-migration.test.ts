import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bundles } from '../server/bundles.ts';
import { ColdMigrations } from '../server/cold-migration.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { Machines, MigrationFingerprint } from '../server/machines.ts';

test('cold migration persists a retry identity and removes only an unchanged source after a remote receipt', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-cold-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vmId = randomUUID();
  const peerId = randomUUID();
  const remoteId = randomUUID();
  const remoteVmId = randomUUID();
  const fingerprint: MigrationFingerprint = { recordHash: 'a'.repeat(64),
    diskSize: 1024, diskMtimeMs: 1234 };
  const records = new Map<string, { id: string; cpus: number; memoryMiB: number }>(
    [[vmId, { id: vmId, cpus: 2, memoryMiB: 1024 }]]);
  let deletions = 0;
  const machines = {
    records,
    get: (id: string) => {
      const vm = records.get(id);
      if (!vm) throw new Error('missing');
      return vm;
    },
    requireStopped: () => {},
    migrationFingerprint: async () => ({ ...fingerprint }),
    delete: async (id: string, expected: MigrationFingerprint) => {
      assert.deepEqual(expected, fingerprint);
      deletions += 1;
      records.delete(id);
    },
  } as unknown as Machines;
  const transfers: string[] = [];
  let published = false;
  let eligible = true;
  const peers = {
    view: () => ({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] }),
    score: async () => ({ candidates: [{ id: remoteId, source: 'peer', eligible,
      score: eligible ? 90 : null, reasons: eligible ? [] : ['容量不足'],
      status: { platform: 'win32', arch: 'x64' } }] }),
    status: async () => ({ platform: 'win32', arch: 'x64' }),
    upload: async (_peer: string, transferId: string) => {
      transfers.push(transferId);
      published = true;
      return { id: remoteVmId, name: 'migrated' };
    },
    importStatus: async () => published ? { id: remoteVmId, name: 'migrated' } : null,
  } as unknown as HostPeers;
  const bundles = { export: async () => { throw new Error('fake peer handles upload'); } } as unknown as Bundles;
  const file = join(root, 'queue.json');
  const options = { peerId, targetName: 'migrated', confirmSourceRemoval: false };
  const first = new ColdMigrations(machines, bundles, peers, file);
  await first.init();
  assert.equal((await first.preview(vmId, {})).ready, false);
  const copied = await first.run(vmId, options, new AbortController().signal);
  assert.equal(copied.phase, 'copied');
  assert.equal(deletions, 0);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  delete stored.entries[0].remoteVmId;
  stored.entries[0].status = 'review';
  await writeFile(file, JSON.stringify(stored));
  eligible = false;
  const restarted = new ColdMigrations(machines, bundles, peers, file);
  await restarted.init();
  assert.equal((await restarted.preview(vmId, options)).ready, true);
  const moved = await restarted.run(vmId, { ...options, confirmSourceRemoval: true },
    new AbortController().signal);
  assert.equal(moved.phase, 'moved');
  assert.equal(deletions, 1);
  assert.equal(transfers.length, 2);
  assert.equal(transfers[0], transfers[1]);
});

test('a changed source is retained even when the remote copy exists', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-cold-change-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vmId = randomUUID();
  const peerId = randomUUID();
  const remoteId = randomUUID();
  let recordHash = 'a'.repeat(64);
  const machines = {
    records: new Map([[vmId, {}]]),
    get: () => ({ cpus: 2, memoryMiB: 1024 }),
    requireStopped: () => {},
    migrationFingerprint: async () => ({ recordHash, diskSize: 1024, diskMtimeMs: 1234 }),
    delete: async () => { throw new Error('source must survive'); },
  } as unknown as Machines;
  const peers = {
    view: () => ({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] }),
    score: async () => ({ candidates: [{ id: remoteId, source: 'peer', eligible: true,
      score: 90, reasons: [], status: { platform: 'win32', arch: 'x64' } }] }),
    status: async () => ({ platform: 'win32', arch: 'x64' }),
    upload: async () => ({ id: randomUUID(), name: 'migrated' }),
  } as unknown as HostPeers;
  const service = new ColdMigrations(machines, {} as Bundles, peers, join(root, 'queue.json'));
  await service.init();
  const options = { peerId, targetName: 'migrated', confirmSourceRemoval: false };
  await service.run(vmId, options, new AbortController().signal);
  recordHash = 'b'.repeat(64);
  await assert.rejects(service.run(vmId, { ...options, confirmSourceRemoval: true },
    new AbortController().signal), /源实例与之前/);
});

test('an interrupted transfer becomes reviewable and retryable after restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-cold-restart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vmId = randomUUID();
  const file = join(root, 'queue.json');
  await writeFile(file, JSON.stringify({ version: 1, entries: [{ vmId,
    transferId: randomUUID(), peerId: randomUUID(), targetName: 'migrated',
    fingerprint: { recordHash: 'a'.repeat(64), diskSize: 1, diskMtimeMs: 1 },
    status: 'transferring', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString() }] }));
  const service = new ColdMigrations({} as Machines, {} as Bundles, {} as HostPeers, file);
  await service.init();
  assert.equal(service.view().entries[0].status, 'review');
  assert.match(service.view().entries[0].error || '', /服务重启/);
});
