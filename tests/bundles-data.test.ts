import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import ssh2 from 'ssh2';
import type { Machines } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-bundle-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Bundles } = await import('../server/bundles.ts');
const { Machines: MachineManager } = await import('../server/machines.ts');
const { vmDir, createSchema } = await import('../server/model.ts');
const { createSshKey, seedIso } = await import('../server/seed.ts');
after(() => rm(root, { recursive: true, force: true }));
const key = createSshKey();
const seed = seedIso({ 'user-data': 'test' });
const disk = Buffer.alloc(104);
disk.writeUInt32BE(0x514649fb);
disk.writeUInt32BE(3, 4);
disk.writeBigUInt64BE(8n * 1024n ** 3n, 24);

function bundle(privateKey = key.privateText) {
  const manifest = Buffer.from(
    JSON.stringify({
      version: 1,
      config: createSchema.parse({ name: 'original' }),
      key: privateKey,
      seed: seed.toString('base64'),
      sha256: createHash('sha256').update(disk).digest('hex'),
    }),
  );
  const prefix = Buffer.alloc(12);
  prefix.write('SAKURA01');
  prefix.writeUInt32BE(manifest.length, 8);
  return Readable.from([prefix, manifest, disk]);
}

test('bundle import requires a private controller identity before publishing a VM', async () => {
  let adopted = false;
  const machines = {
    engine: { run: async () => '{}' },
    adopt: async () => {
      adopted = true;
    },
  } as unknown as Machines;
  await assert.rejects(new Bundles(machines).import('copy', bundle(key.publicText)), /身份/);
  assert.equal(adopted, false);
});

test('bundle import accepts both PEM and modern OpenSSH private controller identities', async () => {
  for (const privateKey of [key.privateText, ssh2.utils.generateKeyPairSync('ed25519').private]) {
    let adoptedKey: string | undefined;
    const machines = {
      engine: { run: async () => '{}' },
      adopt: async (_config: unknown, _disk: string, identity: string) => {
        adoptedKey = identity;
      },
    } as unknown as Machines;
    await new Bundles(machines).import('copy', bundle(privateKey));
    assert.equal(adoptedKey, privateKey);
  }
});

test('import cancellation after disk inspection does not publish a VM', async () => {
  const abort = new AbortController();
  let adopted = false;
  let signal: AbortSignal | undefined;
  const machines = {
    engine: {
      run: async (_command: string, _args: string[], options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        abort.abort();
        return '{}';
      },
    },
    adopt: async () => {
      adopted = true;
    },
  } as unknown as Machines;
  await assert.rejects(new Bundles(machines).import('copy', bundle(), abort.signal), { name: 'AbortError' });
  assert.equal(signal, abort.signal);
  assert.equal(adopted, false);
});

test('clone cancellation after conversion does not publish a VM or remove its source', async () => {
  const id = randomUUID();
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'disk.qcow2'), disk);
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  const abort = new AbortController();
  let adopted = false;
  let signal: AbortSignal | undefined;
  const machines = {
    locked: async (_id: string, work: () => Promise<unknown>) => work(),
    requireStopped: () => {},
    get: () => ({ ...createSchema.parse({ name: 'original' }), snapshots: [] }),
    engine: {
      run: async (_command: string, args: string[], options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        await writeFile(args.at(-1)!, disk);
        abort.abort();
        return '';
      },
    },
    snapshotIdentity: async () => ({ key: key.privateText, seed }),
    adopt: async () => {
      adopted = true;
    },
  } as unknown as Machines;
  await assert.rejects(new Bundles(machines).clone(id, 'copy', undefined, abort.signal), {
    name: 'AbortError',
  });
  assert.equal(signal, abort.signal);
  assert.equal(adopted, false);
  assert.deepEqual(await readFile(join(vmDir(id), 'disk.qcow2')), disk);
});

test('cloning an older snapshot uses its controller identity instead of the current disk key', async () => {
  const id = randomUUID();
  const snapshot = randomUUID();
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'id_rsa'), 'current key');
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  let adoptedKey: string | undefined;
  let adoptedSeed: Buffer | undefined;
  const machines = {
    locked: async (_id: string, work: () => Promise<unknown>) => work(),
    requireStopped: () => {},
    get: () => ({ ...createSchema.parse({ name: 'original' }), snapshots: [{ id: snapshot }] }),
    engine: {
      run: async (_command: string, args: string[]) => {
        assert.deepEqual(args.slice(5, 7), ['-l', snapshot]);
        await writeFile(args.at(-1)!, disk);
        return '';
      },
    },
    snapshotIdentity: async (machineId: string, snapshotId?: string) => {
      assert.equal(machineId, id);
      assert.equal(snapshotId, snapshot);
      return { key: key.privateText, seed };
    },
    adopt: async (_config: unknown, _disk: string, identity: string, initialSeed: Buffer) => {
      adoptedKey = identity;
      adoptedSeed = initialSeed;
    },
  } as unknown as Machines;
  await new Bundles(machines).clone(id, 'copy', snapshot);
  assert.equal(adoptedKey, key.privateText);
  assert.deepEqual(adoptedSeed, seed);
});

async function resizeFixture(t: TestContext) {
  const machines = new MachineManager({
    runtime: { close: async () => {} },
    run: async (_tool, args) => {
      if (args[0] === 'convert') await writeFile(args.at(-1)!, disk);
      return '{}';
    },
  } as Engine);
  await machines.init();
  t.after(() => machines.close());
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: `original-${id.slice(0, 8)}` }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'disk.qcow2'), disk);
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  return { machines, id, bundles: new Bundles(machines) };
}

test('clones use the filesystem resize state of their source disk or selected snapshot', async (t) => {
  const { machines, id, bundles } = await resizeFixture(t);
  await machines.resize(id, 16);
  const before = machines.get(id).snapshots[0];
  const pending = await machines.snapshot(id, 'pending');
  const current = await bundles.clone(id, 'pending-current');
  assert.equal(current.pendingResize, true);

  await machines.completeResize(id);
  const historical = await bundles.clone(id, 'pending-snapshot', pending.id);
  assert.equal(historical.diskGiB, 16);
  assert.equal(historical.pendingResize, true);
  const original = await bundles.clone(id, 'before-resize', before.id);
  assert.equal(original.diskGiB, 8);
  assert.equal(original.pendingResize, false);
  const completed = await bundles.clone(id, 'completed-current');
  assert.equal(completed.pendingResize, false);
});

test('portable backup round trips persist pending filesystem growth across service restarts', async (t) => {
  const { machines, id, bundles } = await resizeFixture(t);
  await machines.resize(id, 16);
  const chunks: Buffer[] = [];
  await bundles.export(
    id,
    new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    () => {},
  );
  const restored = await bundles.import('pending-backup', Readable.from([Buffer.concat(chunks)]));
  assert.equal(restored.diskGiB, 16);
  assert.equal(restored.pendingResize, true);

  const reopened = new MachineManager(machines.engine);
  await reopened.init();
  t.after(() => reopened.close());
  assert.equal(reopened.get(restored.id).pendingResize, true);
});

test('peer bundle imports persist an origin that prevents duplicate transfer adoption', async (t) => {
  const { machines, bundles } = await resizeFixture(t);
  const migrationOrigin = { sourceHostId: randomUUID(), transferId: randomUUID(),
    targetName: 'migrated' };
  const imported = await bundles.import('migrated', bundle(), undefined, undefined, migrationOrigin);
  assert.deepEqual(imported.migrationOrigin, migrationOrigin);
  await assert.rejects(bundles.import('duplicate', bundle(), undefined, undefined, migrationOrigin),
    /已经导入/);
  const reopened = new MachineManager(machines.engine);
  await reopened.init();
  t.after(() => reopened.close());
  assert.deepEqual(reopened.get(imported.id).migrationOrigin, migrationOrigin);
});

test('cold migration deletion rechecks the source disk under its machine lock', async (t) => {
  const { machines, id } = await resizeFixture(t);
  const expected = await machines.migrationFingerprint(id);
  await writeFile(join(vmDir(id), 'disk.qcow2'), Buffer.concat([disk, Buffer.from('changed')]));
  await assert.rejects(machines.delete(id, expected), /源实例在迁移后已变化/);
  assert.ok(machines.records.has(id));
  const afterDiskChange = await machines.migrationFingerprint(id);
  await writeFile(join(vmDir(id), 'project.json'), '{"changed":true}');
  await assert.rejects(machines.delete(id, afterDiskChange), /源实例在迁移后已变化/);
  const current = await machines.migrationFingerprint(id);
  await machines.delete(id, current);
  assert.equal(machines.records.has(id), false);
});

test('legacy portable backups without resize metadata remain importable', async (t) => {
  const { bundles } = await resizeFixture(t);
  const restored = await bundles.import('legacy-backup', bundle());
  assert.equal(!!restored.pendingResize, false);
});

test('UEFI firmware choice survives portable export, import, and clone', async () => {
  const id = randomUUID();
  const vm = {
    ...createSchema.parse({ name: 'firmware-source', firmware: 'uefi' }),
    id, createdAt: new Date().toISOString(), snapshots: [],
  };
  const adopted: unknown[] = [];
  const machines = {
    locked: async (_id: string, work: () => Promise<unknown>) => work(),
    requireStopped: () => {},
    get: () => vm,
    snapshotIdentity: async () => ({ key: key.privateText, seed }),
    engine: { run: async (_tool: string, args: string[]) => {
      if (args[0] === 'convert') await writeFile(args.at(-1)!, disk);
      return '{}';
    } },
    adopt: async (config: unknown) => { adopted.push(config); return { id: randomUUID() }; },
  } as unknown as Machines;
  const bundles = new Bundles(machines);
  const chunks: Buffer[] = [];
  await bundles.export(id, new Writable({
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
  }), () => {});
  const contents = Buffer.concat(chunks);
  const length = contents.readUInt32BE(8);
  const manifest = JSON.parse(contents.subarray(12, 12 + length).toString('utf8'));
  assert.equal(manifest.config.firmware, 'uefi');
  await bundles.import('firmware-copy', Readable.from([contents]));
  await bundles.clone(id, 'firmware-clone');
  assert.equal((adopted[0] as any).firmware, 'uefi');
  assert.equal((adopted[1] as any).firmware, 'uefi');
});
