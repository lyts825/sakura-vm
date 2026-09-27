import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-snapshot-network-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Bundles } = await import('../server/bundles.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { SnapshotReplications } = await import('../server/snapshot-replications.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const { createSshKey, seedIso } = await import('../server/seed.ts');
after(() => rm(root, { recursive: true, force: true }));

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

test('pinned TLS replicates selected historical snapshot with verified receipt and idempotent retry', async () => {
  const disk = Buffer.alloc(104);
  disk.writeUInt32BE(0x514649fb);
  disk.writeUInt32BE(3, 4);
  disk.writeBigUInt64BE(8n * 1024n ** 3n, 24);
  const historical = Buffer.from(disk);
  historical[103] = 0x42;
  const current = Buffer.from(disk);
  current[103] = 0x7a;
  const engine = { runtime: { close: async () => {} },
    run: async (_tool: string, args: string[]) => {
      if (args[0] === 'convert')
        await writeFile(args.at(-1)!, args.includes('-l') ? historical : current);
      return '{}';
    } } as Engine;
  const source = new Machines(engine);
  const destination = new Machines(engine);
  await source.init();
  await destination.init();
  const id = randomUUID();
  const identity = createSshKey();
  const seed = seedIso({ 'user-data': 'historical' });
  source.records.set(id, { ...createSchema.parse({ name: 'source' }), id,
    createdAt: new Date().toISOString(), snapshots: [] });
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'disk.qcow2'), historical);
  await writeFile(join(vmDir(id), 'id_rsa'), identity.privateText);
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  const snapshot = await source.snapshot(id, 'before-change');
  await writeFile(join(vmDir(id), 'disk.qcow2'), current);
  const status = async () => ({ platform: 'win32', arch: 'x64', cpus: 8,
    memoryTotal: 16 * 1024 ** 3, memoryFree: 8 * 1024 ** 3,
    load: [0, 0, 0], vmCount: 1, runningVms: 0 });
  const port = await freePort();
  const targetFile = join(root, 'target-peers.json');
  const setup = new HostPeers(status, targetFile, 'Target');
  await setup.init(false);
  await setup.configure({ operation: 'listener', listener: {
    enabled: true, host: '127.0.0.1', port } });
  await setup.close();
  const target = new HostPeers(status, targetFile, 'Target');
  await target.init(true);
  const local = new HostPeers(status, join(root, 'local-peers.json'), 'Local');
  await local.init(false);
  const targetBundles = new Bundles(destination);
  target.setImportReceiver({
    status: async ({ requesterId, transferId }) => {
      const found = [...destination.records.values()].find((vm) =>
        vm.migrationOrigin?.sourceHostId === requesterId &&
        vm.migrationOrigin.transferId === transferId);
      return found ? { id: found.id, name: found.migrationOrigin!.targetName,
        sha256: found.migrationOrigin!.diskSha256,
        sourceVmId: found.migrationOrigin!.sourceVmId,
        snapshotId: found.migrationOrigin!.snapshotId } : null;
    },
    receive: async ({ requesterId, transferId, name, sourceVmId, snapshotId,
      source: body, signal }) => {
      const imported = await targetBundles.import(name, body, signal, undefined,
        { sourceHostId: requesterId, transferId, targetName: name,
          sourceVmId, snapshotId });
      return { id: imported.id, name, sha256: imported.migrationOrigin?.diskSha256,
        sourceVmId, snapshotId };
    },
  });
  try {
    const issue = await target.configure({ operation: 'create-code' });
    assert.ok('pairing' in issue && issue.pairing);
    await local.configure({ operation: 'connect', url: `https://127.0.0.1:${port}/`,
      fingerprint: target.view().fingerprint, code: issue.pairing.value });
    await target.configure({ operation: 'allow-import',
      id: target.view().incoming[0].id, enabled: true });
    const queueFile = join(root, 'snapshot-replications.json');
    const replication = new SnapshotReplications(source, new Bundles(source), local, queueFile);
    await replication.init();
    const options = { peerId: local.view().outbound[0].id,
      snapshotId: snapshot.id, targetName: 'historical-copy' };
    const copied = await replication.run(id, options, new AbortController().signal);
    const expectedSha = createHash('sha256').update(historical).digest('hex');
    assert.equal(copied.sha256, expectedSha);
    assert.equal(destination.records.size, 1);
    const imported = destination.get(copied.remoteVmId);
    assert.deepEqual(await readFile(join(vmDir(imported.id), 'disk.qcow2')), historical);
    assert.deepEqual(await readFile(join(vmDir(id), 'disk.qcow2')), current);
    assert.equal(imported.migrationOrigin?.sourceVmId, id);
    assert.equal(imported.migrationOrigin?.snapshotId, snapshot.id);
    assert.equal(imported.migrationOrigin?.diskSha256, expectedSha);
    const restarted = new SnapshotReplications(source, new Bundles(source), local, queueFile);
    await restarted.init();
    const retry = await restarted.run(id, options, new AbortController().signal);
    assert.equal(retry.remoteVmId, imported.id);
    assert.equal(retry.sha256, expectedSha);
    assert.equal(destination.records.size, 1);
    assert.equal(restarted.view().entries[0].status, 'replicated');
  } finally {
    await local.close();
    await target.close();
    await source.close();
    await destination.close();
  }
});

test('a mismatched remote checksum remains under review across retries', async () => {
  const id = randomUUID();
  const snapshotId = randomUUID();
  const peerId = randomUUID();
  const remoteId = randomUUID();
  const remoteVmId = randomUUID();
  const snapshot = { id: snapshotId, name: 'old', createdAt: new Date().toISOString(),
    diskGiB: 8, pendingResize: false };
  const vm = { ...createSchema.parse({ name: 'source' }), id,
    createdAt: new Date().toISOString(), snapshots: [snapshot] };
  const machines = {
    locked: async (_id: string, work: () => Promise<unknown>) => work(),
    requireStopped: () => {},
    get: () => vm,
    snapshotIdentity: async () => ({ key: 'identity', seed: Buffer.from('seed') }),
  } as unknown as InstanceType<typeof Machines>;
  let receipt: { id: string; name: string; sha256: string;
    sourceVmId: string; snapshotId: string } | null = null;
  const peers = {
    view: () => ({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] }),
    score: async () => ({ candidates: [{ id: remoteId, source: 'peer', eligible: true,
      reasons: [], status: { platform: 'win32', arch: 'x64' } }] }),
    status: async () => ({ platform: 'win32', arch: 'x64' }),
    importStatus: async () => receipt,
    upload: async (_peer: string, _transfer: string, name: string,
      produce: (target: Writable, signal: AbortSignal) => Promise<unknown>,
      signal: AbortSignal) => {
      await produce(new Writable({ write(_chunk, _encoding, done) { done(); } }), signal);
      receipt = { id: remoteVmId, name, sha256: 'b'.repeat(64),
        sourceVmId: id, snapshotId };
      return receipt;
    },
  } as unknown as InstanceType<typeof HostPeers>;
  const bundles = { export: async () => 'a'.repeat(64) } as unknown as InstanceType<typeof Bundles>;
  const file = join(root, `mismatch-${randomUUID()}.json`);
  const first = new SnapshotReplications(machines, bundles, peers, file);
  await first.init();
  const options = { peerId, snapshotId, targetName: 'old-copy' };
  await assert.rejects(first.run(id, options, new AbortController().signal), /校验值/);
  assert.equal(first.view().entries[0].status, 'review');
  assert.equal(first.view().entries[0].sourceSha256, 'a'.repeat(64));
  const restarted = new SnapshotReplications(machines, bundles, peers, file);
  await restarted.init();
  await assert.rejects(restarted.run(id, options, new AbortController().signal), /校验值/);
  assert.equal(restarted.view().entries[0].status, 'review');
});
