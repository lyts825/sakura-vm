import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { mockS3 } from './support/mock-s3.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-object-backup-smoke-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
process.env.SAKURA_DATA_DIR = join(root, 'data');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Bundles } = await import('../server/bundles.ts');
const { Backups } = await import('../server/backups.ts');
const { Secrets } = await import('../server/secrets.ts');
const { ObjectBackup } = await import('../server/object-backup.ts');
const machines = new Machines(await createRuntime());
const bundles = new Bundles(machines);
const secrets = new Secrets(machines, async (_operation, value) => value);
const backups = new Backups(machines, bundles, secrets);
const object = new ObjectBackup(machines, () => ({ backups, bundles, secrets }));
const s3 = await mockS3();
const signal = new AbortController().signal;

async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 300_000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id) || '客户机启动超时');
    await delay(300);
  }
}

try {
  await machines.init();
  const source = await machines.create({ name: 'object-source' });
  await boot(source.id);
  await machines.writeGuestFile(source.id, '/workspace/object-proof.txt',
    'restored from object storage', false);
  await machines.stop(source.id, false);
  await secrets.save(source.id, { name: 'S3Credentials', value: JSON.stringify({
    accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret',
  }) });
  await secrets.save(source.id, { name: 'BackupPassword', value: 'sakura-object-backup-password' });
  const target = { endpoint: s3.endpoint, bucket: 'sakura-test', prefix: 'smoke',
    credentialSecret: 'S3Credentials', autoUpload: true };
  const saved = await object.action(source.id, { mode: 'save', target }, 'run', signal);
  assert.equal(saved.ready, true);

  for (const kind of ['blocks', 'encrypted'] as const) {
    await backups.policy(source.id, kind === 'blocks'
      ? { deduplicate: true } : { passwordSecret: 'BackupPassword' });
    await backups.run(source.id);
    await backups.jobs.wait(source.id);
    const job = backups.jobs.view(source.id)!;
    assert.equal(job.status, 'done', job.error || job.log);
    const backup = (await backups.view(source.id)).items[0];
    assert.equal(backup.storage === 'blocks', kind === 'blocks');
    assert.equal(!!backup.encrypted, kind === 'encrypted');
    const remoteId = `${source.id}/${backup.id}`;
    await object.tick();
    const status = await object.action(source.id, { mode: 'status' }, 'run', signal);
    assert.ok('sync' in status && status.sync?.mirrored[backup.id] === backup.checksum);
    const verified = await object.action(source.id, { mode: 'verify', remoteId }, 'run', signal);
    assert.ok('verified' in verified && verified.verified);
    const listed = await object.action(source.id, { mode: 'list' }, 'run', signal);
    assert.ok('entries' in listed && listed.entries?.some((entry) => entry.remoteId === remoteId));
    await backups.operate(source.id, backup.id, 'delete');
    const restored = await object.action(source.id, { mode: 'restore', remoteId,
      restoreName: `object-${kind}-restored` }, 'run', signal);
    assert.ok('restoredVmId' in restored && restored.restoredVmId, JSON.stringify(restored));
    const id = restored.restoredVmId;
    await boot(id);
    assert.equal(await machines.readGuestFile(id, '/workspace/object-proof.txt'),
      'restored from object storage');
    await machines.stop(id, false);
    await machines.delete(id);
    await object.action(source.id, { mode: 'delete', remoteId }, 'run', signal);
    console.log(`${kind} backup uploaded, verified, restored and booted from object storage.`);
  }
  assert.ok(s3.partCount >= 2, 'Real VM backup must use multipart upload');
  await machines.delete(source.id);
} finally {
  await object.close();
  await backups.close();
  await machines.close();
  await s3.close();
  await rm(root, { recursive: true, force: true });
}
