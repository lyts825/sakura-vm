import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-signed-bundles-'));
process.env.SAKURA_DATA_DIR = root;
const { Bundles } = await import('../server/bundles.ts');
const { SignedBundles } = await import('../server/signed-bundles.ts');
const { createSchema } = await import('../server/model.ts');
const { createSshKey, seedIso } = await import('../server/seed.ts');
const { encryptFile, importEncrypted } = await import('../server/encrypted-backups.ts');
after(() => rm(root, { recursive: true, force: true }));

const disk = Buffer.alloc(104);
disk.writeUInt32BE(0x514649fb);
disk.writeUInt32BE(3, 4);
disk.writeBigUInt64BE(8n * 1024n ** 3n, 24);
const identity = createSshKey();
const seed = seedIso({ 'user-data': 'signed-bundles' });
const sourceId = randomUUID();
let adopted = 0;
const machines = {
  locked: async (_id: string, work: () => Promise<unknown>) => work(),
  requireStopped: () => {},
  get: () => ({ ...createSchema.parse({ name: 'source' }), snapshots: [] }),
  snapshotIdentity: async () => ({ key: identity.privateText, seed }),
  engine: {
    run: async (_tool: string, args: string[]) => {
      if (args[0] === 'convert') await writeFile(args.at(-1)!, disk);
      return '{}';
    },
  },
  adopt: async () => ({ id: 'adopted-' + ++adopted }),
} as unknown as Machines;

async function exported(bundles: InstanceType<typeof Bundles>) {
  const chunks: Buffer[] = [];
  await bundles.export(
    sourceId,
    new Writable({
      write(chunk, _enc, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    () => {},
  );
  return Buffer.concat(chunks);
}
function parts(value: Buffer) {
  assert.equal(value.subarray(0, 8).toString(), 'SAKURA01');
  const length = value.readUInt32BE(8);
  return {
    manifest: JSON.parse(value.subarray(12, 12 + length).toString('utf8')),
    disk: value.subarray(12 + length),
  };
}
function repack(manifest: unknown, data: Buffer) {
  const json = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(12);
  header.write('SAKURA01');
  header.writeUInt32BE(json.length, 8);
  return Buffer.concat([header, json, data]);
}

test('strict policy signs exports, trusts local signer, rejects unsigned and tampered external packages before adoption', async () => {
  const policy = new SignedBundles(join(root, 'policy.json'));
  await policy.init();
  const bundles = new Bundles(machines, policy);
  const legacy = await exported(bundles);
  assert.equal(parts(legacy).manifest.signature, undefined);
  await bundles.importExternal('old-allowed', Readable.from([legacy]));
  const before = adopted;
  await policy.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  const view = policy.view();
  assert.equal(view.trustedKeys[0].fingerprint, view.localKey?.fingerprint);
  assert.equal(JSON.stringify(view).includes('PRIVATE KEY'), false);
  const signed = await exported(bundles);
  assert.equal(parts(signed).manifest.signature.algorithm, 'Ed25519');
  assert.equal(parts(signed).manifest.signature.publicKey.includes('PRIVATE KEY'), false);
  await assert.rejects(bundles.importExternal('old-rejected', Readable.from([legacy])), /受信任签名/);
  assert.equal(adopted, before);
  await bundles.import('local-legacy-backup', Readable.from([legacy]));
  await bundles.importExternal('signed-accepted', Readable.from([signed]));
  const { manifest, disk: content } = parts(signed);
  await assert.rejects(
    bundles.importExternal(
      'changed-manifest',
      Readable.from([repack({ ...manifest, config: { ...manifest.config, name: 'forged' } }, content)]),
    ),
    /签名无效/,
  );
  const changedDisk = Buffer.from(content);
  changedDisk[100] ^= 1;
  await assert.rejects(
    bundles.importExternal('changed-disk', Readable.from([repack(manifest, changedDisk)])),
    /磁盘校验失败/,
  );
  assert.equal(adopted, before + 2);
  await policy.action({ action: 'configure', revision: 1, requireTrustedOnImport: false });
  await assert.rejects(
    bundles.importExternal(
      'bad-signature-even-when-off',
      Readable.from([repack({ ...manifest, config: { ...manifest.config, name: 'forged' } }, content)]),
    ),
    /签名无效/,
  );
});

test('foreign signer requires explicit trust; policy survives restart and rejects stale edits or corrupt trust records', async () => {
  const local = new SignedBundles(join(root, 'local-policy.json'));
  const foreign = new SignedBundles(join(root, 'foreign-policy.json'));
  await local.init();
  await foreign.init();
  await local.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  await foreign.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  const signed = await exported(new Bundles(machines, foreign));
  const bundles = new Bundles(machines, local);
  const before = adopted;
  await assert.rejects(bundles.importExternal('foreign-rejected', Readable.from([signed])), /不受信任/);
  assert.equal(adopted, before);
  const publicKey = foreign.view().localKey!.publicKey;
  await local.action({ action: 'trust', revision: 1, name: 'other host', publicKey });
  await assert.rejects(
    local.action({ action: 'configure', revision: 1, requireTrustedOnImport: false }),
    /已变化/,
  );
  await bundles.importExternal('foreign-accepted', Readable.from([signed]));
  const restored = new SignedBundles(join(root, 'local-policy.json'));
  await restored.init();
  assert.equal(restored.view().requireTrustedOnImport, true);
  assert.equal(restored.view().trustedKeys.length, 2);
  const foreignKey = restored.view().trustedKeys.find((item) => item.name === 'other host')!;
  await restored.action({ action: 'forget', revision: 2, fingerprint: foreignKey.fingerprint });
  await assert.rejects(
    new Bundles(machines, restored).importExternal('foreign-removed', Readable.from([signed])),
    /不受信任/,
  );
  await assert.rejects(
    restored.action({ action: 'forget', revision: 3, fingerprint: restored.view().localKey!.fingerprint }),
    /本机公钥/,
  );
  const state = JSON.parse(await readFile(join(root, 'local-policy.json'), 'utf8'));
  state.trustedKeys[0].fingerprint = '0'.repeat(64);
  await writeFile(join(root, 'local-policy.json'), JSON.stringify(state));
  await assert.rejects(new SignedBundles(join(root, 'local-policy.json')).init(), /记录损坏/);
  state.trustedKeys = [];
  await writeFile(join(root, 'local-policy.json'), JSON.stringify(state));
  await assert.rejects(new SignedBundles(join(root, 'local-policy.json')).init(), /本机密钥/);
});

test('encrypted external upload enforces signed policy after authenticated decryption', async () => {
  const policy = new SignedBundles(join(root, 'encrypted-policy.json'));
  await policy.init();
  const bundles = new Bundles(machines, policy);
  const legacy = await exported(bundles);
  await policy.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  const signed = await exported(bundles);
  const password = 'correct-bundle-password';
  const plain = join(root, 'plain.sakura');
  const encrypted = join(root, 'encrypted.sakura.enc');
  await writeFile(plain, legacy);
  await encryptFile(plain, encrypted, password);
  const before = adopted;
  await assert.rejects(
    importEncrypted(
      bundles,
      'encrypted-legacy',
      Readable.from([await readFile(encrypted)]),
      password,
      new AbortController().signal,
    ),
    /受信任签名/,
  );
  assert.equal(adopted, before);
  await writeFile(plain, signed);
  await rm(encrypted);
  await encryptFile(plain, encrypted, password);
  await importEncrypted(
    bundles,
    'encrypted-signed',
    Readable.from([await readFile(encrypted)]),
    password,
    new AbortController().signal,
  );
  assert.equal(adopted, before + 1);
});

test('policy edits wait for an authorized publication to finish', async () => {
  const policy = new SignedBundles(join(root, 'serialized-policy.json'));
  await policy.init();
  await policy.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  const signature = parts(await exported(new Bundles(machines, policy))).manifest.signature;
  let finish!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const finishPromise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const publishing = policy.withAuthorizedExternal(signature, async () => {
    started();
    await finishPromise;
  });
  await startedPromise;
  let changed = false;
  const edit = policy.action({ action: 'configure', revision: 1, requireTrustedOnImport: false }).then(() => {
    changed = true;
  });
  await Promise.resolve();
  assert.equal(changed, false);
  assert.equal(policy.view().requireTrustedOnImport, true);
  finish();
  await Promise.all([publishing, edit]);
  assert.equal(policy.view().requireTrustedOnImport, false);
});
