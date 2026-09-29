import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-trusted-snapshots-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { TrustedBootService } = await import('../server/trusted-boot-service.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-trusted-snapshots-'));
  await rm(root, { recursive: true, force: true });
});

test('stopped snapshots keep TPM and NVRAM with their disk and reject damaged or legacy state', async (t) => {
  const commands: string[][] = [];
  const machines = new Machines({ runtime: { close: async () => {} },
    run: async (_tool, args) => { commands.push(args); return ''; } } as Engine);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, { ...createSchema.parse({ name: 'trusted-snapshot',
    distro: 'debian', firmware: 'uefi' }), id,
    createdAt: new Date().toISOString(), snapshots: [] });
  const directory = vmDir(id);
  await mkdir(join(directory, 'tpm2'), { recursive: true });
  await writeFile(join(directory, 'id_rsa'), 'controller');
  await writeFile(join(directory, 'seed.iso'), 'seed');
  await writeFile(join(directory, 'uefi-secure-vars.fd'), 'original-vars');
  await writeFile(join(directory, 'tpm2', 'tpm2-00.permall'), 'original-tpm');
  await writeFile(join(root, 'trusted-boot.json'), JSON.stringify({ [id]: { enabled: true } }));
  const service = new TrustedBootService(machines);
  await service.init();
  t.after(async () => { await service.close(); await machines.close(); });

  const shot = await machines.snapshot(id, 'trusted state');
  const original = await service.capture(id, shot.id);
  assert.equal(original?.enabled, true);
  assert.deepEqual(original?.files.map((file) => file.name),
    ['uefi-secure-vars.fd', 'tpm2/tpm2-00.permall']);
  await writeFile(join(directory, 'uefi-secure-vars.fd'), 'changed-vars');
  await writeFile(join(directory, 'tpm2', 'tpm2-00.permall'), 'changed-tpm');
  await writeFile(join(directory, 'tpm2', 'extra'), 'new-state');
  await machines.restore(id, shot.id);
  assert.deepEqual(await service.capture(id), original);
  await assert.rejects(readFile(join(directory, 'tpm2', 'extra')), { code: 'ENOENT' });

  const second = await machines.snapshot(id, 'tamper-check');
  const sidecar = join(directory, `.snapshot-${second.id}.trusted-boot.json`);
  const archive = JSON.parse(await readFile(sidecar, 'utf8'));
  archive.files[0].sha256 = '0'.repeat(64);
  await writeFile(sidecar, JSON.stringify(archive));
  const appliedBefore = commands.filter((args) => args.includes('-a')).length;
  await assert.rejects(machines.restore(id, second.id), /校验失败/);
  assert.equal(commands.filter((args) => args.includes('-a')).length, appliedBefore);

  const legacy = { id: randomUUID(), name: 'legacy', createdAt: new Date().toISOString() };
  machines.get(id).snapshots.push(legacy);
  await assert.rejects(service.capture(id, legacy.id), /没有对应的 TPM\/NVRAM 状态/);
  await assert.rejects(machines.restore(id, legacy.id), /没有对应的 TPM\/NVRAM 状态/);

  await machines.editSnapshot(id, shot.id, null);
  await assert.rejects(readFile(join(directory, `.snapshot-${shot.id}.trusted-boot.json`)),
    { code: 'ENOENT' });

  await service.action(id, { operation: 'configure', policy: { enabled: false } });
  await rm(join(directory, 'uefi-secure-vars.fd'));
  await rm(join(directory, 'tpm2'), { recursive: true });
  const plain = await machines.snapshot(id, 'before trusted boot');
  await mkdir(join(directory, 'tpm2'));
  await writeFile(join(directory, 'uefi-secure-vars.fd'), 'later-vars');
  await writeFile(join(directory, 'tpm2', 'later'), 'later-tpm');
  await machines.restore(id, plain.id);
  assert.equal(await service.capture(id), undefined);
  await assert.rejects(readFile(join(directory, 'uefi-secure-vars.fd')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(directory, 'tpm2', 'later')), { code: 'ENOENT' });
});

test('online disk snapshots reject active TPM state before freezing the guest', async (t) => {
  const machines = new Machines({ runtime: { close: async () => {} },
    run: async (_tool, _args) => '' } as Engine);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, { ...createSchema.parse({ name: 'online-trusted',
    distro: 'debian', firmware: 'uefi' }), id,
    createdAt: new Date().toISOString(), snapshots: [] });
  const directory = vmDir(id);
  await mkdir(directory);
  await writeFile(join(directory, 'uefi-secure-vars.fd'), 'vars');
  const service = new TrustedBootService(machines);
  await service.init();
  t.after(async () => { machines.live.delete(id); await service.close(); await machines.close(); });
  machines.live.set(id, { status: 'running' } as any);
  await assert.rejects(machines.onlineSnapshot(id, 'unsafe'), /需要停机快照/);
  assert.equal(machines.get(id).snapshots.length, 0);
});
