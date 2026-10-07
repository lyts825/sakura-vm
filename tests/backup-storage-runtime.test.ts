/**
 * 回归范围（完整情景见下方用例与断言）：
 * - a real 128 GiB sparse QCOW2 backup fits a 64 MiB free-space budget and retains its VM lock while queued
 * - real sparse LUKS QCOW2 measurement uses the encrypted output format before backup admission
 * - backup verification failure releases I/O, but an actual materialized-file cleanup failure remains charged
 */
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

async function interruptedPublication(
  f: ReturnType<typeof fixture>,
  options: { indexed?: boolean; corrupt?: boolean; stagedOnly?: boolean } = {},
) {
  const { backupPublication } = await import('../server/backup-journal.ts');
  const directory = join(root, 'backups', f.id),
    backupId = randomUUID(),
    bytes = Buffer.from('verified publication fixture');
  await mkdir(directory, { recursive: true });
  const record = {
    id: backupId,
    createdAt: new Date().toISOString(),
    bytes: bytes.length,
    checksum: digest(bytes),
  };
  const file = join(directory, backupId + '.sakura');
  if (!options.stagedOnly) await writeFile(file, options.corrupt ? Buffer.from('tampered') : bytes);
  await writeFile(file + '.part', 'interrupted owned staging');
  const journal = backupPublication(join(directory, 'publication.json'));
  await journal.replace({
    version: 1,
    id: backupId,
    encrypted: false,
    deduplicate: false,
    record,
    obsolete: [],
  });
  if (options.indexed)
    await metadataFile(join(directory, 'index.json'), () => ({})).replace({
      policy: backupPolicySchema.parse({}),
      items: [record],
    });
  return { directory, file, record, journal };
}

test('restarted backup controller reconciles publish-before-index and index-before-cleanup without another export', async () => {
  for (const indexed of [false, true]) {
    const f = fixture(),
      item = await interruptedPublication(f, { indexed });
    f.bundles.withExportBudget = async () => {
      throw new Error('Recovery must never replay source export');
    };
    try {
      const restarted = new Backups(f.machines, f.bundles, undefined, f.storage);
      const view = await restarted.view(f.id);
      assert.deepEqual(
        view.items.map((value) => value.id),
        [item.record.id],
      );
      assert.equal(view.items[0].checksum, item.record.checksum);
      assert.deepEqual(await readFile(item.file), Buffer.from('verified publication fixture'));
      await assert.rejects(stat(item.file + '.part'), { code: 'ENOENT' });
      assert.equal((await item.journal.read()).value, null);
      assert.equal((await restarted.view(f.id)).items.length, 1, 'Reconciliation is idempotent');
      assert.equal(f.host.snapshot().resources.length, 0);
      await restarted.close();
    } finally {
      await f.backups.close();
      f.host.close();
    }
  }
});

test('interrupted staging is discarded, while a changed published backup remains available for inspection', async () => {
  const staged = fixture(),
    draft = await interruptedPublication(staged, { stagedOnly: true });
  try {
    assert.equal((await staged.backups.view(staged.id)).items.length, 0);
    await assert.rejects(stat(draft.file + '.part'), { code: 'ENOENT' });
    assert.equal((await draft.journal.read()).value, null);
  } finally {
    await staged.backups.close();
    staged.host.close();
  }
  const corrupt = fixture(),
    damaged = await interruptedPublication(corrupt, { corrupt: true });
  try {
    await assert.rejects(corrupt.backups.view(corrupt.id), { code: 'BACKUP_RECOVERY_REQUIRED' });
    assert.equal((await readFile(damaged.file)).toString(), 'tampered');
    assert.ok((await damaged.journal.read()).value, 'Failed verification preserves the recovery record');
    assert.equal(
      corrupt.host.snapshot().resources.length,
      0,
      'Verification failure alone does not retain I/O',
    );
  } finally {
    await corrupt.backups.close();
    corrupt.host.close();
  }
});

test('reconciliation completes a journaled obsolete-file cleanup and preserves newly protected backups', async () => {
  const f = fixture(),
    item = await interruptedPublication(f, { indexed: true });
  const obsolete = { ...item.record, id: randomUUID() },
    protectedItem = {
      ...item.record,
      id: randomUUID(),
      retainUntil: new Date(Date.now() + 60_000).toISOString(),
    };
  const index = metadataFile<any>(join(item.directory, 'index.json'), () => ({}));
  await index.update((value) => {
    value.items.push(obsolete, protectedItem);
  });
  await writeFile(join(item.directory, obsolete.id + '.sakura'), 'old');
  await writeFile(join(item.directory, protectedItem.id + '.sakura'), 'protected');
  await item.journal.update((value) => {
    value!.obsolete = [obsolete, protectedItem];
  });
  try {
    const view = await f.backups.view(f.id);
    assert.deepEqual(
      view.items.map((value) => value.id),
      [item.record.id, protectedItem.id],
    );
    await assert.rejects(stat(join(item.directory, obsolete.id + '.sakura')), { code: 'ENOENT' });
    assert.equal(
      (await readFile(join(item.directory, protectedItem.id + '.sakura'))).toString(),
      'protected',
    );
  } finally {
    await f.backups.close();
    f.host.close();
  }
});

test('an obstructed recovery temporary file retains I/O and repeat reads report the same failure without queueing again', async () => {
  const f = fixture(),
    item = await interruptedPublication(f);
  const temporary = item.file + '.part';
  await rm(temporary);
  await mkdir(temporary);
  await writeFile(join(temporary, 'held'), 'fixture');
  try {
    await assert.rejects(f.backups.view(f.id), { code: 'STORAGE_CLEANUP_PENDING' });
    const held = f.host.snapshot().resources[0];
    assert.equal(held.state, 'cleanup-pending');
    await assert.rejects(f.backups.view(f.id), { code: 'STORAGE_CLEANUP_PENDING' });
    assert.equal(f.host.snapshot().queued, 0);
    assert.ok((await item.journal.read()).value);
    assert.equal(f.host.snapshot().resources[0].id, held.id);
    await rm(temporary, { recursive: true, force: true });
    f.leases.at(-1)!.release();
  } finally {
    for (const lease of f.leases) lease.release();
    await f.backups.close();
    f.host.close();
  }
});
