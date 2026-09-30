import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
const { TrustedBootService } = await import('../server/trusted-boot-service.ts');
const { verifyBackup } = await import('../server/backups.ts');
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

test('portable backups and clones retain the KDE recovery project without exporting its environment', async (t) => {
  const { machines, id, bundles } = await resizeFixture(t);
  const binding = { version: 1, projectId: 'default', directory: '/workspace',
    networkIsolation: 'private', launcherSha256: 'a'.repeat(64), enabled: true };
  await writeFile(join(vmDir(id), 'desktop-binding.json'), JSON.stringify(binding));
  const chunks: Buffer[] = [];
  await bundles.export(id, new Writable({ write(chunk, _encoding, done) {
    chunks.push(Buffer.from(chunk)); done();
  } }), () => {});
  const payload = Buffer.concat(chunks);
  const length = payload.readUInt32BE(8);
  assert.deepEqual(JSON.parse(payload.subarray(12, 12 + length).toString()).desktopBinding, binding);
  const restored = await bundles.import('desktop-import', Readable.from([payload]));
  const cloned = await bundles.clone(id, 'desktop-clone');
  for (const copy of [restored, cloned])
    assert.deepEqual(JSON.parse(await readFile(join(vmDir(copy.id), 'desktop-binding.json'), 'utf8')), binding);
});

test('peer bundle imports persist an origin that prevents duplicate transfer adoption', async (t) => {
  const { machines, bundles } = await resizeFixture(t);
  const migrationOrigin = { sourceHostId: randomUUID(), transferId: randomUUID(),
    targetName: 'migrated' };
  const imported = await bundles.import('migrated', bundle(), undefined, undefined, migrationOrigin);
  const persistedOrigin = { ...migrationOrigin,
    diskSha256: createHash('sha256').update(disk).digest('hex') };
  assert.deepEqual(imported.migrationOrigin, persistedOrigin);
  await assert.rejects(bundles.import('duplicate', bundle(), undefined, undefined, migrationOrigin),
    /已经导入/);
  const reopened = new MachineManager(machines.engine);
  await reopened.init();
  t.after(() => reopened.close());
  assert.deepEqual(reopened.get(imported.id).migrationOrigin, persistedOrigin);
});

test('portable backups and clones retain X11 application identities, rules and controller ownership', async (t) => {
  const { id, bundles } = await resizeFixture(t);
  const settings = { schemaVersion: 1, version: 4, owner: randomUUID(), applications: [{
    image: '/usr/bin/konsole', sha256: 'c'.repeat(64),
    rule: { copy: false, paste: true, files: false, sensitive: true, maxTextBytes: 4096 },
  }] };
  await writeFile(join(vmDir(id), 'x11-clipboard.json'), JSON.stringify(settings));
  const chunks: Buffer[] = [];
  await bundles.export(id, new Writable({ write(chunk, _encoding, done) {
    chunks.push(Buffer.from(chunk)); done();
  } }), () => {});
  const payload = Buffer.concat(chunks), length = payload.readUInt32BE(8);
  assert.deepEqual(JSON.parse(payload.subarray(12, 12 + length).toString()).x11Clipboard, settings);
  const imported = await bundles.import('clipboard-import', Readable.from([payload]));
  const cloned = await bundles.clone(id, 'clipboard-clone');
  for (const copy of [imported, cloned])
    assert.deepEqual(JSON.parse(await readFile(join(vmDir(copy.id), 'x11-clipboard.json'), 'utf8')), settings);
  await writeFile(join(vmDir(id), 'x11-clipboard.json'), JSON.stringify({ ...settings, owner: 'invalid' }));
  await assert.rejects(bundles.clone(id, 'clipboard-invalid'));
});

test('bundle export selects historical snapshot disk, identity, and resize state', async (t) => {
  const { machines, id, bundles } = await resizeFixture(t);
  const snapshot = randomUUID();
  const historicalDisk = Buffer.from(disk);
  historicalDisk[103] = 0x5a;
  const olderKey = ssh2.utils.generateKeyPairSync('ed25519').private;
  const olderSeed = seedIso({ 'user-data': 'historical' });
  const vm = machines.get(id);
  vm.snapshots.push({ id: snapshot, name: 'historical', createdAt: new Date().toISOString(),
    diskGiB: 8, pendingResize: false });
  vm.diskGiB = 16;
  vm.pendingResize = true;
  await writeFile(join(vmDir(id), `.snapshot-${snapshot}.json`), JSON.stringify({
    key: olderKey, seed: olderSeed.toString('base64'),
  }));
  const calls: string[][] = [];
  machines.engine.run = async (_tool, args) => {
    calls.push(args);
    if (args[0] === 'convert') await writeFile(args.at(-1)!, args.includes('-l') ? historicalDisk : disk);
    return '{}';
  };
  const chunks: Buffer[] = [];
  const sha256 = await bundles.export(id, new Writable({
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
  }), () => {}, undefined, 0, snapshot);
  assert.deepEqual(calls[0].slice(5, 7), ['-l', snapshot]);
  assert.equal(sha256, createHash('sha256').update(historicalDisk).digest('hex'));
  const contents = Buffer.concat(chunks);
  const length = contents.readUInt32BE(8);
  const manifest = JSON.parse(contents.subarray(12, 12 + length).toString('utf8'));
  assert.equal(manifest.config.diskGiB, 8);
  assert.equal(manifest.pendingResize, false);
  assert.equal(manifest.key, olderKey);
  assert.equal(manifest.seed, olderSeed.toString('base64'));
  assert.deepEqual(contents.subarray(12 + length), historicalDisk);
  assert.deepEqual(await readFile(join(vmDir(id), 'disk.qcow2')), disk);
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

test('portable backup, import, and clone retain TPM identity and secure NVRAM', async (t) => {
  const { machines, id, bundles } = await resizeFixture(t);
  const service = new TrustedBootService(machines);
  await service.init();
  t.after(() => service.close());
  bundles.setTrustedBoot(service);
  const vars = randomBytes(340_000);
  const permanent = Buffer.from('persistent-tpm-identity');
  await service.restore(id, { enabled: true, files: [
    { name: 'uefi-secure-vars.fd', data: vars },
    { name: 'tpm2/tpm2-00.permall', data: permanent },
  ] });
  await writeFile(join(vmDir(id), 'tpm2', '.lock'), 'transient');
  const firstFingerprint = await machines.migrationFingerprint(id);
  const chunks: Buffer[] = [];
  await bundles.export(id, new Writable({
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
  }), () => {});
  const contents = Buffer.concat(chunks);
  const manifestLength = contents.readUInt32BE(8);
  assert.ok(manifestLength > 300_000);
  const file = join(root, `${id}.sakura`);
  await writeFile(file, contents);
  await verifyBackup(file, new AbortController().signal);
  const imported = await bundles.import('trusted-import', Readable.from([contents]));
  const cloned = await bundles.clone(id, 'trusted-clone');
  for (const target of [imported, cloned]) {
    assert.equal((await service.view(target.id)).policy.enabled, true);
    assert.deepEqual(await readFile(join(vmDir(target.id), 'uefi-secure-vars.fd')), vars);
    assert.deepEqual(await readFile(join(vmDir(target.id), 'tpm2', 'tpm2-00.permall')), permanent);
    await assert.rejects(readFile(join(vmDir(target.id), 'tpm2', '.lock')), { code: 'ENOENT' });
  }
  await writeFile(join(vmDir(id), 'tpm2', 'tpm2-00.permall'), 'changed');
  assert.notDeepEqual(await machines.migrationFingerprint(id), firstFingerprint);
  const snapshot = randomUUID();
  machines.get(id).snapshots.push({ id: snapshot, name: 'older',
    createdAt: new Date().toISOString() });
  await assert.rejects(bundles.export(id, new Writable({ write(_chunk, _encoding, callback) {
    callback();
  } }), () => {}, undefined, 0, snapshot), /没有对应的 TPM\/NVRAM 状态/);
  await assert.rejects(bundles.clone(id, 'trusted-history', snapshot), /没有对应的 TPM\/NVRAM 状态/);
});

test('tampered TPM state is rejected before import and backup verification', async (t) => {
  const { machines, id, bundles } = await resizeFixture(t);
  const service = new TrustedBootService(machines);
  await service.init();
  t.after(() => service.close());
  bundles.setTrustedBoot(service);
  await service.restore(id, { enabled: true, files: [
    { name: 'tpm2/tpm2-00.permall', data: Buffer.from('secret') },
  ] });
  const chunks: Buffer[] = [];
  await bundles.export(id, new Writable({
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
  }), () => {});
  const contents = Buffer.concat(chunks);
  const length = contents.readUInt32BE(8);
  const manifest = JSON.parse(contents.subarray(12, 12 + length).toString('utf8'));
  manifest.trustedBoot.files[0].sha256 = '0'.repeat(64);
  const tamperedManifest = Buffer.from(JSON.stringify(manifest));
  const prefix = Buffer.alloc(12);
  prefix.write('SAKURA01');
  prefix.writeUInt32BE(tamperedManifest.length, 8);
  const tampered = Buffer.concat([prefix, tamperedManifest, contents.subarray(12 + length)]);
  const count = machines.records.size;
  await assert.rejects(bundles.import('tampered-tpm', Readable.from([tampered])),
    /TPM 状态校验失败/);
  assert.equal(machines.records.size, count);
  const file = join(root, `${id}-tampered.sakura`);
  await writeFile(file, tampered);
  await assert.rejects(verifyBackup(file, new AbortController().signal), /TPM 状态校验失败/);
});
