import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { createSchema } from '../shared/contracts/vm.ts';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { StorageRuntime, type StorageLease } from '../server/storage-runtime.ts';
import type { Machines } from '../server/machines.ts';
import { metadataFile } from '../server/metadata-store.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-storage-budget-'));
process.env.SAKURA_DATA_DIR = root;
const { Backups, backupPolicySchema } = await import('../server/backups.ts');
const { Bundles } = await import('../server/bundles.ts');
const { backupBlocks } = await import('../server/backup-blocks.ts');
const { vmDir } = await import('../server/paths.ts');
const { qemuSecretObject } = await import('../server/disk-encryption.ts');
const binary = resolve(
  process.env.SAKURA_QEMU_DIR || '.tools/qemu',
  process.platform === 'win32' ? 'qemu-img.exe' : 'qemu-img',
);
const execute = promisify(execFile);
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const signal = new AbortController().signal;
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true });
});
function fixture() {
  const id = randomUUID(),
    record = { ...createSchema.parse({ name: 'sparse', diskGiB: 128 }), id, snapshots: [] };
  const queues = new Map<string, Promise<unknown>>();
  const machines = {
    get: () => record,
    requireStopped() {},
    requireUnlocked() {},
    live: new Map(),
    records: new Map([[id, record]]),
    locked<T>(key: string, work: () => Promise<T>) {
      const result = (queues.get(key) || Promise.resolve()).catch(() => {}).then(work);
      queues.set(key, result);
      return result;
    },
    snapshotIdentity: async () => ({ key: 'fixture-private-key', seed: Buffer.alloc(34816) }),
    engine: {
      run: async (_tool: string, args: string[], options: { signal?: AbortSignal } = {}) =>
        (await execute(binary, args, { windowsHide: true, signal: options.signal })).stdout,
    },
  } as unknown as Machines;
  const host = new HostRuntime();
  const leases: StorageLease[] = [];
  const storage = new StorageRuntime(host, async (path) => ({
    key: 'fixture-device',
    path,
    totalBytes: 1024 ** 3,
    freeBytes: 64 * 1024 ** 2,
  }));
  const acquire = storage.acquire.bind(storage);
  storage.acquire = async (request) => {
    const lease = await acquire(request);
    leases.push(lease);
    return lease;
  };
  const bundles = new Bundles(machines),
    backups = new Backups(machines, bundles, undefined, storage);
  return { id, machines, host, storage, leases, bundles, backups };
}

test(
  'a real 128 GiB sparse QCOW2 backup fits a 64 MiB free-space budget and retains its VM lock while queued',
  { skip: !existsSync(binary) },
  async () => {
    const { id, machines, host, storage, backups } = fixture();
    await mkdir(vmDir(id), { recursive: true });
    const base = join(root, id + '.base.qcow2'),
      disk = join(vmDir(id), 'disk.qcow2');
    await execute(binary, ['create', '-f', 'qcow2', base, '128G'], { windowsHide: true });
    await execute(binary, ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', base, disk], { windowsHide: true });
    const gate = await storage.acquire({
      owner: 'test:gate',
      taskId: 'gate',
      label: 'Hold writer',
      mode: 'write',
      paths: [root],
      buffers: 1,
      files: 1,
    });
    let measured!: () => void;
    const ready = new Promise<void>((done) => {
      measured = done;
    });
    const run = machines.engine.run.bind(machines.engine);
    machines.engine.run = async (...args: Parameters<typeof run>) => {
      const result = await run(...args);
      if (args[1][0] === 'measure') measured();
      return result;
    };
    try {
      const job = await backups.run(id);
      await ready;
      let changed = false;
      const mutation = machines.locked(id, async () => {
        changed = true;
      });
      await new Promise<void>((done) => setImmediate(done));
      assert.equal(changed, false, 'The measured source must stay locked while admission waits');
      gate.release();
      await backups.jobs.wait(id);
      await mutation;
      assert.equal(job.status, 'done', job.error);
      const item = (await backups.view(id)).items[0];
      assert.ok(item.bytes < 16 * 1024 ** 2);
      assert.ok((await stat(disk)).size < 16 * 1024 ** 2);
      assert.equal(host.snapshot().resources.length, 0);
      assert.deepEqual(await readdir(join(root, 'transfers')), []);
    } finally {
      gate.release();
      await backups.close();
      host.close();
    }
  },
);

test(
  'real sparse LUKS QCOW2 measurement uses the encrypted output format before backup admission',
  { skip: !existsSync(binary) },
  async () => {
    const { id, machines, backups, host } = fixture();
    await mkdir(vmDir(id), { recursive: true });
    const secret = join(vmDir(id), 'test-key'),
      disk = join(vmDir(id), 'disk.qcow2');
    await writeFile(secret, 'test-disk-password-not-a-real-secret', { mode: 0o600 });
    machines.get(id).diskEncryption = { format: 'luks', secretName: 'disk-password' };
    machines.withDiskSecret = async (_vm, work) => work(secret);
    await execute(
      binary,
      [
        'create',
        '--object',
        qemuSecretObject(secret),
        '-f',
        'qcow2',
        '-o',
        'encrypt.format=luks,encrypt.key-secret=sakura-disk-key',
        disk,
        '128G',
      ],
      { windowsHide: true },
    );
    try {
      const job = await backups.run(id);
      await backups.jobs.wait(id);
      assert.equal(job.status, 'done', job.error);
      assert.ok((await backups.view(id)).items[0].bytes < 32 * 1024 ** 2);
      assert.equal(host.snapshot().resources.length, 0);
    } finally {
      await backups.close();
      host.close();
    }
  },
);

test('backup verification failure releases I/O, but an actual materialized-file cleanup failure remains charged', async () => {
  const { id, host, leases, backups } = fixture();
  const disk = Buffer.from('disk-content'),
    manifest = Buffer.from(JSON.stringify({ sha256: digest(disk) }));
  const prefix = Buffer.alloc(12);
  prefix.write('SAKURA01');
  prefix.writeUInt32BE(manifest.length, 8);
  const bundle = Buffer.concat([prefix, manifest, disk]),
    directory = join(root, 'backups', id);
  await mkdir(directory, { recursive: true });
  const index = metadataFile(join(directory, 'index.json'), () => ({
    policy: backupPolicySchema.parse({}),
    items: [] as any[],
  }));
  const bad = Buffer.from(bundle);
  bad[bad.length - 1] ^= 1;
  const badId = randomUUID(),
    badPath = join(directory, badId + '.sakura');
  await writeFile(badPath, bad);
  await index.replace({
    policy: backupPolicySchema.parse({}),
    items: [{ id: badId, bytes: bad.length, checksum: digest(bad) }],
  });
  try {
    await assert.rejects(
      backups.withVerifiedFile(id, badId, undefined, signal, async () => {}),
      /磁盘校验失败/,
    );
    assert.equal(host.snapshot().resources.length, 0);
    const goodId = randomUUID(),
      source = join(directory, 'source.sakura');
    await writeFile(source, bundle);
    await backupBlocks().pack(id, goodId, source, digest(bundle), signal);
    await index.replace({
      policy: backupPolicySchema.parse({}),
      items: [{ id: goodId, bytes: bundle.length, checksum: digest(bundle), storage: 'blocks' }],
    });
    let obstructed = '';
    await assert.rejects(
      backups.withVerifiedFile(id, goodId, undefined, signal, async (file) => {
        assert.deepEqual(await readFile(file), bundle);
        // Replace our own temporary file with a directory to force a real rm failure.
        await rm(file);
        await mkdir(file);
        await writeFile(join(file, 'held'), 'owned test fixture');
        obstructed = file;
      }),
      { code: 'STORAGE_CLEANUP_PENDING' },
    );
    assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
    assert.ok(host.snapshot().budgets.some((value) => value.key === 'io' && value.used === 1));
    assert.ok(resolve(obstructed).startsWith(resolve(root) + (process.platform === 'win32' ? '\\' : '/')));
    await rm(obstructed, { recursive: true, force: true });
    leases.at(-1)!.release();
    assert.equal(host.snapshot().resources.length, 0);
  } finally {
    for (const lease of leases) lease.release();
    await backups.close();
    host.close();
  }
});
