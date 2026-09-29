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
  const digest = 'b'.repeat(64);
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
      return { id: remoteVmId, name: 'migrated', sha256: digest };
    },
    importStatus: async () => published
      ? { id: remoteVmId, name: 'migrated', sha256: digest } : null,
    checkImportActivation: async () => ({ ready: true, id: remoteVmId, status: 'stopped' }),
    activateImport: async () => { throw new Error('target launch reply lost'); },
  } as unknown as HostPeers;
  const bundles = { export: async () => { throw new Error('fake peer handles upload'); } } as unknown as Bundles;
  const file = join(root, 'queue.json');
  const options = { peerId, targetName: 'migrated', confirmSourceRemoval: false };
  const first = new ColdMigrations(machines, bundles, peers, file);
  await first.init();
  assert.equal((await first.preview(vmId, {})).ready, false);
  assert.match((await first.preview(vmId, { ...options,
    confirmSourceRemoval: true, startTarget: true })).reason || '', /先完成一次/);
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
  await assert.rejects(restarted.run(vmId, { ...options,
    confirmSourceRemoval: true, startTarget: true }, new AbortController().signal), /当前不可选/);
  assert.equal(deletions, 0);
  eligible = true;
  await assert.rejects(restarted.run(vmId, { ...options,
    confirmSourceRemoval: true, startTarget: true }, new AbortController().signal),
  /源实例已移除，但目标启动未确认/);
  assert.equal(deletions, 1);
  assert.equal(restarted.view().entries[0].status, 'moved');
  assert.match(restarted.view().entries[0].error || '', /启动未确认/);
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

test('maintenance drain copies every stopped VM before allowing a reviewed removal pass', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-maintenance-drain-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const peerId = randomUUID();
  const remoteId = randomUUID();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const records = new Map<string, { id: string; name: string; cpus: number; memoryMiB: number }>([
    [firstId, { id: firstId, name: 'alpha', cpus: 2, memoryMiB: 1024 }],
    [secondId, { id: secondId, name: 'beta', cpus: 2, memoryMiB: 1024 }],
  ]);
  let running: string = secondId;
  let failBeta = true;
  let changedBeta = false;
  const receipts = new Map<string, { id: string; name: string }>();
  const transfers = new Map<string, string[]>();
  const deleted: string[] = [];
  const machines = {
    records,
    get: (id: string) => {
      const vm = records.get(id);
      if (!vm) throw new Error('missing');
      return vm;
    },
    requireStopped: (id: string) => {
      if (id === running) throw new Error('请先停止实例');
    },
    migrationFingerprint: async (id: string) => ({ recordHash: id === secondId && changedBeta
      ? 'a'.repeat(64) : id.replaceAll('-', '').padEnd(64, '0'),
      diskSize: 1024, diskMtimeMs: 1234 }),
    delete: async (id: string) => {
      deleted.push(id);
      records.delete(id);
    },
  } as unknown as Machines;
  const peers = {
    view: () => ({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] }),
    score: async () => ({ candidates: [{ id: remoteId, source: 'peer', eligible: true,
      score: 90, reasons: [], status: { platform: 'win32', arch: 'x64' } }] }),
    status: async () => ({ platform: 'win32', arch: 'x64' }),
    upload: async (_peer: string, transferId: string, name: string) => {
      transfers.set(name, [...(transfers.get(name) || []), transferId]);
      if (name === 'beta' && failBeta) throw new Error('temporary transfer failure');
      if (!receipts.has(transferId)) receipts.set(transferId, { id: randomUUID(), name });
      return receipts.get(transferId)!;
    },
    importStatus: async (_peer: string, transferId: string) => receipts.get(transferId) || null,
  } as unknown as HostPeers;
  const service = new ColdMigrations(machines, {} as Bundles, peers, join(root, 'queue.json'));
  await service.init();
  const copy = { peerId, confirmSourceRemoval: false };
  const remove = { peerId, confirmSourceRemoval: true };
  assert.equal((await service.previewDrain({ ...copy,
    targetNames: { [randomUUID()]: 'unused' } })).ready, false);
  assert.equal((await service.previewDrain({ ...copy,
    targetNames: { [secondId]: 'alpha' } })).ready, false);
  const blocked = await service.previewDrain(copy);
  assert.equal(blocked.ready, false);
  assert.match(JSON.stringify(blocked.machines), /请先停止实例/);
  running = '';
  await assert.rejects(service.runDrain(remove, new AbortController().signal), /尚无已确认/);
  assert.equal(deleted.length, 0);
  await assert.rejects(service.runDrain(copy, new AbortController().signal), /temporary transfer failure/);
  assert.equal(deleted.length, 0);
  failBeta = false;
  const copied = await service.runDrain(copy, new AbortController().signal);
  assert.equal(copied.phase, 'copied');
  assert.equal(copied.remainingSourceVms, 2);
  assert.equal(deleted.length, 0);
  assert.equal(new Set(transfers.get('beta')).size, 1);
  assert.equal(new Set(transfers.get('alpha')).size, 1);
  changedBeta = true;
  assert.equal((await service.previewDrain(copy)).ready, false);
  const namedCopy = { ...copy, targetNames: { [secondId]: 'beta-updated' } };
  const namedRemove = { ...remove, targetNames: namedCopy.targetNames };
  assert.equal((await service.previewDrain(namedCopy)).ready, true);
  await service.runDrain(namedCopy, new AbortController().signal);
  const betaTransfer = transfers.get('beta-updated')![0];
  const betaReceipt = receipts.get(betaTransfer)!;
  receipts.delete(betaTransfer);
  assert.equal((await service.previewDrain(namedRemove)).ready, false);
  receipts.set(betaTransfer, betaReceipt);
  const moved = await service.runDrain(namedRemove, new AbortController().signal);
  assert.equal(moved.phase, 'moved');
  assert.equal(moved.remainingSourceVms, 0);
  assert.deepEqual(new Set(deleted), new Set([firstId, secondId]));
});
