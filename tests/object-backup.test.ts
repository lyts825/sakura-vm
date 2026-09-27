import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile, mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mockS3 } from '../scripts/support/mock-s3.ts';

test('S3 target checks, multipart upload, integrity, restore and deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-object-test-'));
  process.env.SAKURA_DATA_DIR = join(root, 'data');
  const { ObjectBackup } = await import('../server/object-backup.ts');
  const { verifyBackup } = await import('../server/backups.ts');
  const { vmDir } = await import('../server/model.ts');
  const id = randomUUID(), backupId = randomUUID(), restoredId = randomUUID();
  const payload = Buffer.alloc(9 * 1024 * 1024, 0x61);
  const manifest = Buffer.from(JSON.stringify({ sha256: createHash('sha256').update(payload).digest('hex') }));
  const prefix = Buffer.alloc(12);
  prefix.write('SAKURA01'); prefix.writeUInt32BE(manifest.length, 8);
  const file = join(root, 'backup.sakura');
  const content = Buffer.concat([prefix, manifest, payload]);
  await writeFile(file, content);
  const item = { id: backupId, bytes: content.length,
    checksum: createHash('sha256').update(content).digest('hex'),
    createdAt: new Date().toISOString(), encrypted: false,
    retainUntil: new Date(Date.now() + 3600_000).toISOString() };
  await mkdir(vmDir(id), { recursive: true });
  const s3 = await mockS3();
  const machines = { get: () => ({ id }), requireUnlocked: () => {},
    locked: async (_key: string, work: () => Promise<unknown>) => work() };
  const backups = {
    view: async () => ({ items: [item] }),
    withVerifiedFile: async (_id: string, _backupId: string, _password: string | undefined,
      signal: AbortSignal, work: (file: string) => Promise<unknown>) => {
      await verifyBackup(file, signal); return work(file);
    },
    downloadable: async () => ({ type: 'file' as const, path: file }),
  };
  const restored: string[] = [];
  const bundles = { importExternal: async (name: string, stream: NodeJS.ReadableStream) => {
    restored.push(name);
    for await (const _chunk of stream) { /* consume verified bundle */ }
    return { id: restoredId, name };
  } };
  const secrets = { value: async (_id: string, name: string) => {
    assert.equal(name, 'S3Credentials');
    return JSON.stringify({ accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' });
  } };
  const object = new ObjectBackup(machines as never, () =>
    ({ backups: backups as never, bundles: bundles as never, secrets: secrets as never }));
  const signal = new AbortController().signal;
  const target = { endpoint: s3.endpoint, bucket: 'sakura-test', prefix: 'checks',
    credentialSecret: 'S3Credentials' };
  const remoteId = `${id}/${backupId}`;
  try {
    assert.equal((await object.action(id, { mode: 'status' }, 'run', signal)).ready, false);
    const checked = await object.action(id, { mode: 'save', target }, 'check', signal);
    assert.equal(checked.ready, true);
    assert.equal(checked.executed, false);
    assert.equal((await object.action(id, { mode: 'status' }, 'run', signal)).ready, false);
    await object.action(id, { mode: 'save', target }, 'run', signal);
    const saved = await readFile(join(vmDir(id), 'object-backup.json'), 'utf8');
    assert.ok(!saved.includes('fixture-secret'));
    const first = await object.action(id, { mode: 'upload', backupId }, 'run', signal);
    assert.equal(first.executed, true);
    assert.ok(s3.partCount >= 2, '9 MiB backup must use multipart upload');
    const second = await object.action(id, { mode: 'upload', backupId }, 'run', signal);
    assert.equal(second.executed, false, 'same remote bytes are reused');
    const listed = await object.action(id, { mode: 'list' }, 'run', signal);
    assert.ok('entries' in listed && listed.entries?.some((entry) => entry.remoteId === remoteId));
    const dataKey = `checks/sakura-backups/${id}/${backupId}.sakura`;
    const original = s3.objects.get(dataKey)!;
    assert.ok(original);
    const corrupted = Buffer.from(original);
    corrupted[corrupted.length - 1] ^= 0xff;
    s3.objects.set(dataKey, corrupted);
    await assert.rejects(() => object.action(id, { mode: 'verify', remoteId }, 'run', signal),
      /SHA-256/);
    await assert.rejects(() => object.action(id, { mode: 'restore', remoteId,
      restoreName: 'should-not-exist' }, 'run', signal), /SHA-256/);
    assert.deepEqual(restored, []);
    s3.objects.set(dataKey, original);
    const verified = await object.action(id, { mode: 'verify', remoteId }, 'run', signal);
    assert.ok('verified' in verified && verified.verified);
    const result = await object.action(id, { mode: 'restore', remoteId,
      restoreName: 'object-restored' }, 'run', signal);
    assert.ok('restoredVmId' in result && result.restoredVmId === restoredId);
    assert.deepEqual(restored, ['object-restored']);
    await assert.rejects(() => object.action(id, { mode: 'delete', remoteId }, 'run', signal),
      /保留锁定期/);
    const metadataKey = `checks/sakura-backups/${id}/${backupId}.json`;
    const metadata = JSON.parse(s3.objects.get(metadataKey)!.toString());
    metadata.retainUntil = new Date(Date.now() - 1000).toISOString();
    s3.objects.set(metadataKey, Buffer.from(JSON.stringify(metadata)));
    await object.action(id, { mode: 'delete', remoteId }, 'run', signal);
    const empty = await object.action(id, { mode: 'list' }, 'run', signal);
    assert.ok('entries' in empty && empty.entries?.length === 0);
  } finally {
    await s3.close();
    await rm(root, { recursive: true, force: true });
  }
});
