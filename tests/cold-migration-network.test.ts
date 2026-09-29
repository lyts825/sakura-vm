import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-cold-network-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Bundles } = await import('../server/bundles.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { ColdMigrations } = await import('../server/cold-migration.ts');
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

test('pinned peer TLS streams a real validated bundle into a distinct machine manager', async () => {
  const engine = { runtime: { close: async () => {} },
    run: async (_tool: string, args: string[]) => {
      if (args[0] === 'convert') await copyFile(args.at(-2)!, args.at(-1)!);
      return '{}';
    } } as Engine;
  const source = new Machines(engine);
  const destination = new Machines(engine);
  await source.init();
  await destination.init();
  const id = randomUUID();
  const key = createSshKey();
  const seed = seedIso({ 'user-data': 'test' });
  const disk = Buffer.alloc(104);
  disk.writeUInt32BE(0x514649fb);
  disk.writeUInt32BE(3, 4);
  disk.writeBigUInt64BE(8n * 1024n ** 3n, 24);
  source.records.set(id, { ...createSchema.parse({ name: 'source' }), id,
    createdAt: new Date().toISOString(), snapshots: [] });
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'disk.qcow2'), disk);
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
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
  let activated = false;
  target.setImportReceiver({
    status: async ({ requesterId, transferId }) => {
      const found = [...destination.records.values()].find((vm) =>
        vm.migrationOrigin?.sourceHostId === requesterId &&
        vm.migrationOrigin.transferId === transferId);
      return found ? { id: found.id, name: found.migrationOrigin!.targetName,
        sha256: found.migrationOrigin!.diskSha256 } : null;
    },
    receive: async ({ requesterId, transferId, name, source: body, signal }) => {
      const imported = await targetBundles.import(name, body, signal, undefined,
        { sourceHostId: requesterId, transferId, targetName: name });
      return { id: imported.id, name, sha256: imported.migrationOrigin!.diskSha256 };
    },
    inspectActivation: async ({ remoteVmId }) => ({ id: remoteVmId, status: 'stopped' }),
    activate: async ({ requesterId, transferId, remoteVmId, sha256 }) => {
      assert.equal(source.records.has(id), false);
      const imported = destination.get(remoteVmId);
      assert.equal(imported.migrationOrigin?.sourceHostId, requesterId);
      assert.equal(imported.migrationOrigin?.transferId, transferId);
      assert.equal(imported.migrationOrigin?.diskSha256, sha256);
      activated = true;
      return { id: remoteVmId, status: 'starting' };
    },
  });
  try {
    const issue = await target.configure({ operation: 'create-code' });
    assert.ok('pairing' in issue && issue.pairing);
    await local.configure({ operation: 'connect', url: `https://127.0.0.1:${port}/`,
      fingerprint: target.view().fingerprint, code: issue.pairing.value });
    await target.configure({ operation: 'allow-import',
      id: target.view().incoming[0].id, enabled: true });
    const migration = new ColdMigrations(source, new Bundles(source), local,
      join(root, 'cold-migrations.json'));
    await migration.init();
    const options = { peerId: local.view().outbound[0].id,
      targetName: 'migrated', confirmSourceRemoval: false };
    const copied = await migration.run(id, options, new AbortController().signal);
    assert.equal(copied.phase, 'copied');
    assert.equal(copied.sourceRemoved, false);
    assert.equal(destination.records.size, 1);
    const imported = destination.get(copied.remoteVmId);
    assert.deepEqual(await readFile(join(vmDir(imported.id), 'disk.qcow2')), disk);
    assert.equal(imported.migrationOrigin?.transferId, copied.transferId);
    const retry = await migration.run(id, options, new AbortController().signal);
    assert.equal(retry.remoteVmId, imported.id);
    assert.equal(destination.records.size, 1);
    await assert.rejects(migration.run(id, { ...options, startTarget: true },
      new AbortController().signal), /明确确认移除源实例/);
    await assert.rejects(migration.run(id, { ...options,
      confirmSourceRemoval: true, startTarget: true }, new AbortController().signal), /HTTP 403/);
    assert.equal(source.records.has(id), true);
    assert.equal(activated, false);
    await target.configure({ operation: 'allow-activate',
      id: target.view().incoming[0].id, enabled: true });
    const moved = await migration.run(id, { ...options,
      confirmSourceRemoval: true, startTarget: true }, new AbortController().signal);
    assert.equal(moved.phase, 'moved');
    assert.equal(moved.sourceRemoved, true);
    assert.ok('targetStart' in moved && moved.targetStart);
    assert.equal(moved.targetStart.status, 'starting');
    assert.equal(activated, true);
    assert.equal(source.records.has(id), false);
  } finally {
    await local.close();
    await target.close();
    await source.close();
    await destination.close();
  }
});
