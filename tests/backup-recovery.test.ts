import assert from 'node:assert/strict';
import test, { after, type TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { Engine } from '../server/runtime.ts';
import type { BackupRecord } from '../server/backups.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-recovery-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Bundles } = await import('../server/bundles.ts');
const { Backups, backupPolicySchema } = await import('../server/backups.ts');
const { BackupRecovery } = await import('../server/backup-recovery.ts');
const { Jobs } = await import('../server/jobs.ts');
const { SandboxArtifacts } = await import('../server/sandbox-artifacts.ts');
const { backupBlocks } = await import('../server/backup-blocks.ts');
const { createSchema } = await import('../server/model.ts');
const { createSshKey, seedIso } = await import('../server/seed.ts');
const { encryptFile } = await import('../server/encrypted-backups.ts');
const { backupRecoverySchema } = await import('../shared/backup-recovery.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-recovery-test-'));
  await rm(root, { recursive: true, force: true });
});
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const signal = new AbortController().signal;
const privateKey = createSshKey().privateText;
const disk = Buffer.alloc(4096);
disk.writeUInt32BE(0x514649fb);
disk.writeUInt32BE(3, 4);
disk.writeBigUInt64BE(4n * 1024n ** 3n, 24);
disk.write('backup disk', 256);
const manifest = Buffer.from(
  JSON.stringify({
    version: 1,
    config: createSchema.parse({ name: 'from-backup' }),
    key: privateKey,
    seed: seedIso({ 'user-data': 'fixture' }).toString('base64'),
    sha256: hash(disk),
  }),
);
const length = Buffer.alloc(4);
length.writeUInt32BE(manifest.length);
const bundle = Buffer.concat([Buffer.from('SAKURA01'), length, manifest, disk]);

async function fixture(t: TestContext) {
  const id = randomUUID(),
    directory = join(root, 'backups', id),
    artifactsDirectory = join(root, 'artifacts', id);
  await mkdir(directory, { recursive: true });
  const machines = new Machines({ run: async () => '{}', runtime: { close: async () => {} } } as unknown as Engine);
  machines.records.set(id, {
    ...createSchema.parse({ name: 'source' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  const bundles = new Bundles(machines),
    backups = new Backups(machines, bundles),
    jobs = new Jobs('backup-recovery', join(root, 'jobs', id));
  const artifacts = new SandboxArtifacts(machines, artifactsDirectory);
  const service = new BackupRecovery(machines, backups, bundles, jobs, artifacts);
  const items: BackupRecord[] = [];
  let boots = 0,
    cleaned = 0,
    ready: (() => void) | undefined,
    hold = false;
  machines.withRescue = (async (_id, abort, _phase, work, _log, file) =>
    machines.locked(id, async () => {
      assert.deepEqual(await readFile(file!), disk);
      boots++;
      try {
        ready?.();
        if (hold) await delay(60000, undefined, { signal: abort });
        return await work('temporary-rescue', abort);
      } finally {
        cleaned++;
      }
    })) as typeof machines.withRescue;
  machines.exec = async () => ({ code: 0, stdout: '', stderr: '' });
  machines.sftp = (async (_id, work) =>
    work(
      {
        realpath: (path: string, callback: (error: null, value: string) => void) =>
          callback(null, path.endsWith('/escape') ? '/etc/shadow' : path),
        lstat: (path: string, callback: (error: null, value: unknown) => void) =>
          callback(null, { size: path.endsWith('/huge') ? 9 * 1024 ** 2 : 8, isFile: () => true }),
        createReadStream: () => Readable.from([Buffer.from('restored')]),
      } as any,
      signal,
    )) as typeof machines.sftp;
  const saveIndex = () =>
    writeFile(join(directory, 'index.json'), JSON.stringify({ policy: backupPolicySchema.parse({}), items }));
  const add = async (kind: 'plain' | 'blocks' | 'encrypted' = 'plain') => {
    const backupId = randomUUID(),
      source = join(directory, backupId + '.sakura');
    await writeFile(source, bundle);
    const item: BackupRecord = {
      id: backupId,
      createdAt: new Date().toISOString(),
      bytes: bundle.length,
      checksum: hash(bundle),
    };
    if (kind === 'encrypted') {
      const encrypted = source + '.enc';
      await encryptFile(source, encrypted, 'fixture-password-2026', signal);
      const bytes = await readFile(encrypted);
      item.encrypted = true;
      item.checksum = hash(bytes);
      item.bytes = bytes.length;
      await rm(source);
    } else if (kind === 'blocks') {
      await backupBlocks().pack(id, backupId, source, item.checksum, signal);
      item.storage = 'blocks';
      await rm(source);
    }
    items.push(item);
    await saveIndex();
    return item;
  };
  t.after(async () => {
    await service.close();
    await backups.close();
    await machines.close();
  });
  return {
    id,
    directory,
    machines,
    bundles,
    backups,
    service,
    jobs,
    add,
    items,
    saveIndex,
    artifactsDirectory,
    counts: () => ({ boots, cleaned }),
    hold: (callback: () => void) => {
      hold = true;
      ready = callback;
    },
  };
}

test('file recovery requires explicit valid backup, partition and bounded file selection', () => {
  const good = { backupId: randomUUID(), paths: ['workspace/readme.txt'] };
  assert.equal(backupRecoverySchema.parse(good).partition, 0);
  for (const change of [
    { paths: [] },
    { paths: ['../outside'] },
    { paths: ['/absolute'] },
    { paths: ['a', 'a'] },
    { paths: Array.from({ length: 9 }, (_, i) => 'f' + i) },
    { partition: null },
    { partition: -1 },
    { command: 'arbitrary command' },
    { disk: 'C:\\host.qcow2' },
  ])
    assert.equal(backupRecoverySchema.safeParse({ ...good, ...change }).success, false);
});

test('plain, encrypted and deduplicated backups yield verified disks, files and durable reports without registering an instance', async (t) => {
  const f = await fixture(t);
  for (const kind of ['plain', 'encrypted', 'blocks'] as const) {
    const item = await f.add(kind);
    const job = f.service.run(f.id, {
      backupId: item.id,
      paths: ['workspace/readme.txt'],
      password: kind === 'encrypted' ? 'fixture-password-2026' : undefined,
    });
    await f.jobs.wait(f.id);
    assert.equal(job.status, 'done', job.error);
    const artifact = await f.service.artifact(f.id, job.id!, job.execution!.artifacts[0].id);
    assert.equal(Buffer.from(artifact.base64, 'base64').toString(), 'restored');
    assert.equal(artifact.sha256, hash(Buffer.from('restored')));
    assert.equal((await f.jobs.result(job.id!)).backupId, item.id);
    assert.equal(f.machines.records.size, 1);
    assert.ok(!JSON.stringify(job).includes('fixture-password'));
    assert.ok(!JSON.stringify(job).includes(privateKey));
  }
  await f.jobs.flush();
  const restored = new Jobs('backup-recovery', join(root, 'jobs', f.id));
  t.after(() => restored.close());
  assert.equal(restored.list().length, 3);
  assert.deepEqual(f.counts(), { boots: 3, cleaned: 3 });
  assert.deepEqual(await readdir(join(root, 'transfers')), []);
});

test('wrong passwords, broken bundle hashes and missing records fail before booting a rescue system', async (t) => {
  const f = await fixture(t);
  const encrypted = await f.add('encrypted');
  const job = f.service.run(f.id, {
    backupId: encrypted.id,
    paths: ['workspace/readme.txt'],
    password: 'incorrect-password-2026',
  });
  await f.jobs.wait(f.id);
  assert.equal(job.status, 'error');
  const plain = await f.add();
  const corrupted = Buffer.from(bundle);
  corrupted[corrupted.length - 1] ^= 1;
  await writeFile(join(f.directory, plain.id + '.sakura'), corrupted);
  plain.checksum = hash(corrupted);
  await f.saveIndex();
  const invalid = f.service.run(f.id, { backupId: plain.id, paths: ['workspace/readme.txt'] });
  await f.jobs.wait(f.id);
  assert.equal(invalid.status, 'error');
  assert.match(invalid.error!, /磁盘校验失败/);
  const absent = f.service.run(f.id, { backupId: randomUUID(), paths: ['workspace/readme.txt'] });
  await f.jobs.wait(f.id);
  assert.match(absent.error!, /不存在/);
  assert.equal(f.counts().boots, 0);
});

test('file extraction rejects escaping links and oversized files and validates saved artifacts on download', async (t) => {
  const f = await fixture(t),
    item = await f.add();
  for (const path of ['escape', 'huge']) {
    const job = f.service.run(f.id, { backupId: item.id, paths: [path] });
    await f.jobs.wait(f.id);
    assert.equal(job.status, 'error');
    assert.equal(job.execution!.artifacts.length, 0);
  }
  const job = f.service.run(f.id, { backupId: item.id, paths: ['workspace/readme.txt'] });
  await f.jobs.wait(f.id);
  const artifact = job.execution!.artifacts[0];
  await writeFile(join(f.artifactsDirectory, `${job.id}.${artifact.id}.bin`), 'tampered');
  await assert.rejects(f.service.artifact(f.id, job.id!, artifact.id), /校验失败/);
});

test('active recovery locks the backup against removal and cancels before temporary disk cleanup', async (t) => {
  const f = await fixture(t),
    item = await f.add();
  const ready = new Promise<void>((done) => f.hold(done));
  const job = f.service.run(f.id, { backupId: item.id, paths: ['workspace/readme.txt'] });
  await ready;
  await assert.rejects(f.backups.operate(f.id, item.id, 'delete'), /另一项/);
  await assert.rejects(f.machines.start(f.id), /另一项/);
  f.jobs.cancel(f.id);
  await f.jobs.wait(f.id);
  assert.equal(job.status, 'cancelled');
  assert.deepEqual(f.counts(), { boots: 1, cleaned: 1 });
  assert.deepEqual(await readdir(join(root, 'transfers')), []);
  assert.equal(f.machines.isBusy(f.id), false);
  await f.backups.operate(f.id, item.id, 'delete');
});

test('incident lockdown and service shutdown cancel admitted recovery and reject new requests', async (t) => {
  const f = await fixture(t),
    item = await f.add();
  let ready = new Promise<void>((done) => f.hold(done));
  let job = f.service.run(f.id, { backupId: item.id, paths: ['workspace/readme.txt'] });
  await ready;
  await f.machines.setIncidentLockdown(f.id, true);
  await f.jobs.wait(f.id);
  assert.equal(job.status, 'cancelled');
  await f.machines.setIncidentLockdown(f.id, false);
  ready = new Promise<void>((done) => f.hold(done));
  job = f.service.run(f.id, { backupId: item.id, paths: ['workspace/readme.txt'] });
  await ready;
  await f.service.close();
  assert.equal(job.status, 'cancelled');
  assert.throws(() => f.service.run(f.id, { backupId: item.id, paths: ['workspace/readme.txt'] }), /关闭/);
  assert.deepEqual(await readdir(join(root, 'transfers')), []);
});
