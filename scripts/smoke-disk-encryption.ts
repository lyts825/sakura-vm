import assert from 'node:assert/strict';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-encrypted-vm-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Secrets } = await import('../server/secrets.ts');
const { Bundles } = await import('../server/bundles.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const secrets = new Secrets(machines);
const bundles = new Bundles(machines);
const password = 'sakura-encryption-smoke-very-private-password';
try {
  const original = await machines.create({ name: 'encrypted-source', distro: 'alpine',
    memoryMiB: 1024, cpus: 2, diskGiB: 4, accelerator: 'tcg' });
  await secrets.save(original.id, { name: 'DiskPassphrase', value: password });
  const enabled = await machines.encryptDisk(original.id, 'DiskPassphrase');
  assert.equal(enabled.encrypted, true);
  assert.equal(enabled.enabled, true);
  await assert.rejects(machines.encryptDisk(original.id, 'DiskPassphrase'), /已经加密/);
  const shot = await machines.snapshot(original.id, 'encrypted snapshot');
  await machines.restore(original.id, shot.id);
  await machines.editSnapshot(original.id, shot.id, null);
  await machines.resize(original.id, 5);
  assert.equal(machines.get(original.id).diskGiB, 5);
  const clone = await bundles.clone(original.id, 'encrypted-clone');
  assert.equal(clone.diskEncryption?.secretName, 'DiskPassphrase');
  assert.equal((await machines.diskEncryptionStatus(clone.id)).encrypted, true);
  assert.equal(await secrets.value(clone.id, 'DiskPassphrase'), password);
  const archive = join(directory, 'encrypted.sakura');
  const beforeGrowth = machines.get(original.id).snapshots.at(-1)!;
  await bundles.export(original.id, createWriteStream(archive, { flags: 'wx' }),
    () => {}, undefined, 0, beforeGrowth.id);
  const imported = await bundles.import('encrypted-import', createReadStream(archive));
  assert.equal((await machines.diskEncryptionStatus(imported.id)).encrypted, true);
  assert.equal(imported.diskGiB, 4);
  await assert.rejects(machines.start(imported.id), /缺少私密配置/);
  await secrets.save(imported.id, { name: 'DiskPassphrase', value: password });
  await machines.start(original.id);
  const deadline = Date.now() + 300000;
  while (machines.state(original.id) !== 'running') {
    assert.equal(machines.state(original.id), 'starting', machines.logs.get(original.id));
    assert.ok(Date.now() < deadline, machines.logs.get(original.id));
    await delay(300);
  }
  const result = await machines.exec(original.id, 'printf disk-encryption-ready');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /disk-encryption-ready/);
  console.log('LUKS conversion, snapshots, resize, clone, export/import and boot verified.');
} finally {
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-encrypted-vm-'));
  await rm(directory, { recursive: true, force: true });
}
