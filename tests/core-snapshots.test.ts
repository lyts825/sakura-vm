import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-core-snapshots-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-core-snapshots-'));
  await rm(root, { recursive: true, force: true });
});

async function fixture(t: TestContext) {
  const commands: string[][] = [];
  const machines = new Machines({
    runtime: { close: async () => {} },
    run: async (_tool, args) => {
      commands.push(args);
      return '';
    },
  } as Engine);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'snapshot-test' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  const dir = vmDir(id);
  await mkdir(dir);
  await writeFile(join(dir, 'id_rsa'), 'original-private-key');
  await writeFile(join(dir, 'seed.iso'), 'original-seed');
  t.after(() => machines.close());
  return { machines, id, dir, commands };
}

test('disk growth creates a recovery snapshot and restores its original capacity metadata', async (t) => {
  const { machines, id, commands } = await fixture(t);
  await machines.resize(id, 16);
  assert.equal(machines.get(id).diskGiB, 16);
  assert.ok(machines.get(id).pendingResize);
  const shot = machines.get(id).snapshots[0];
  assert.equal(shot.diskGiB, 8);
  assert.equal(commands[0][0], 'snapshot');
  assert.equal(commands[1][0], 'resize');
  await assert.rejects(machines.resize(id, 4), /仅支持扩容/);
  await machines.restore(id, shot.id);
  assert.equal(machines.get(id).diskGiB, 8);
  assert.equal(machines.get(id).pendingResize, false);
});

test('disk growth preserves legacy snapshot capacity across multiple expansions', async (t) => {
  const { machines, id } = await fixture(t);
  const legacy = { id: randomUUID(), name: 'legacy', createdAt: new Date().toISOString() };
  machines.get(id).snapshots.push(legacy);
  await machines.resize(id, 16);
  await machines.resize(id, 24);
  assert.equal(machines.get(id).snapshots.find((shot) => shot.id === legacy.id)?.diskGiB, 8);
  await machines.restore(id, legacy.id);
  assert.equal(machines.get(id).diskGiB, 8);
});

test('snapshots restore unfinished filesystem growth and preserve it in recovery backups', async (t) => {
  const { machines, id } = await fixture(t);
  await machines.resize(id, 16);
  const pending = await machines.snapshot(id, 'filesystem-growth-pending');
  await machines.completeResize(id);
  const completed = await machines.snapshot(id, 'filesystem-growth-complete');

  await machines.restore(id, pending.id);
  assert.equal(machines.get(id).diskGiB, 16);
  assert.equal(machines.get(id).pendingResize, true);
  await machines.restore(id, completed.id, true);
  assert.equal(machines.get(id).pendingResize, false);
  const recovery = machines.get(id).snapshots.find((shot) => shot.name === '恢复前自动备份')!;
  await machines.restore(id, recovery.id);
  assert.equal(machines.get(id).pendingResize, true);
});

test('restoring a pre-first-boot snapshot restores the matching controller and pending identity', async (t) => {
  const { machines, id, dir } = await fixture(t);
  const pending = JSON.stringify({ privateText: 'new-private-key', publicText: 'new-public-key' });
  await writeFile(join(dir, 'identity.json'), pending);
  const snapshot = await machines.snapshot(id, 'before-first-boot');
  await writeFile(join(dir, 'id_rsa'), 'new-private-key');
  await rm(join(dir, 'identity.json'));
  await machines.restore(id, snapshot.id);
  assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'original-private-key');
  assert.equal(await readFile(join(dir, 'identity.json'), 'utf8'), pending);
  const identity = await machines.snapshotIdentity(id, snapshot.id);
  assert.equal(identity.key, 'original-private-key');
  assert.equal(identity.seed.toString(), 'original-seed');
});

test('restoring a later snapshot removes stale pending rotation and preserves a usable restore backup', async (t) => {
  const { machines, id, dir } = await fixture(t);
  const snapshot = await machines.snapshot(id, 'completed-boot');
  await writeFile(join(dir, 'id_rsa'), 'other-private-key');
  await writeFile(join(dir, 'identity.json'), '{"privateText":"pending-key"}');
  await machines.restore(id, snapshot.id, true);
  assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'original-private-key');
  await assert.rejects(readFile(join(dir, 'identity.json')), { code: 'ENOENT' });
  const backup = machines.get(id).snapshots.find((entry) => entry.id !== snapshot.id)!;
  assert.equal((await machines.snapshotIdentity(id, backup.id)).key, 'other-private-key');
  await machines.restore(id, backup.id);
  assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'other-private-key');
  assert.equal(await readFile(join(dir, 'identity.json'), 'utf8'), '{"privateText":"pending-key"}');
});

test('legacy snapshots without identity metadata keep their existing controller identity', async (t) => {
  const { machines, id, dir } = await fixture(t);
  const legacy = { id: randomUUID(), name: 'legacy', createdAt: new Date().toISOString() };
  machines.get(id).snapshots.push(legacy);
  await machines.restore(id, legacy.id);
  assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'original-private-key');
  assert.equal((await machines.snapshotIdentity(id, legacy.id)).key, 'original-private-key');
  await assert.rejects(machines.snapshotIdentity(id, randomUUID()), /不存在/);
});
