import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import ssh2 from 'ssh2';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-bundle-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Bundles } = await import('../server/bundles.ts');
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
