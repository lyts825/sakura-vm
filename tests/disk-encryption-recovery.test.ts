import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-disk-recovery-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-disk-recovery-'));
  await rm(root, { recursive: true, force: true });
});

test('startup finalizes published encryption and rolls back an uncommitted conversion', async () => {
  const encrypted = randomUUID(), plain = randomUUID();
  const records = [
    { ...createSchema.parse({ name: 'encrypted' }), id: encrypted,
      createdAt: new Date().toISOString(), snapshots: [] },
    { ...createSchema.parse({ name: 'plain' }), id: plain,
      createdAt: new Date().toISOString(), snapshots: [] },
  ];
  for (const id of [encrypted, plain]) {
    await mkdir(vmDir(id), { recursive: true });
    await writeFile(join(vmDir(id), 'disk.qcow2'), 'disk');
    await writeFile(join(vmDir(id), '.disk.encrypting.qcow2'), 'interrupted');
    await writeFile(join(vmDir(id), '.disk.before-encrypt.qcow2'), 'previous');
    await writeFile(join(vmDir(id), '.disk-encryption.pending.json'),
      JSON.stringify({ format: 'luks', secretName: 'DiskPassphrase' }));
  }
  await writeFile(join(root, 'machines.json'), JSON.stringify(records));
  const engine = { run: async (_name: string, args: string[]) => JSON.stringify({
    format: 'qcow2', encrypted: args.at(-1)?.includes(encrypted) }),
    runtime: { close: async () => {} } } as unknown as Engine;
  const machines = new Machines(engine);
  await machines.init();
  try {
    assert.equal(machines.get(encrypted).diskEncryption?.secretName, 'DiskPassphrase');
    assert.equal(machines.get(plain).diskEncryption, undefined);
    const persisted = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
    assert.equal(persisted.length, 2);
    assert.equal(persisted[0].diskEncryption.secretName, 'DiskPassphrase');
    for (const id of [encrypted, plain])
      for (const file of ['.disk.encrypting.qcow2', '.disk.before-encrypt.qcow2',
        '.disk-encryption.pending.json'])
        await assert.rejects(readFile(join(vmDir(id), file)), { code: 'ENOENT' });
  } finally { await machines.close(); }
  const mismatch = new Machines({ ...engine,
    run: async () => JSON.stringify({ format: 'qcow2', encrypted: false }) } as Engine);
  await assert.rejects(mismatch.init(), /加密标记与磁盘格式不一致/);
  await mismatch.close();
});
