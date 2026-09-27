import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-golden-test-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Bundles } = await import('../server/bundles.ts');
const { GoldenImages } = await import('../server/golden-images.ts');
const { Jobs } = await import('../server/jobs.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const { createSshKey, seedIso } = await import('../server/seed.ts');
after(() => rm(root, { recursive: true, force: true }));
const key = createSshKey(),
  seed = seedIso({ 'user-data': 'fixture' });
const disk = Buffer.alloc(4096, 0);
disk.writeUInt32BE(0x514649fb);
disk.writeUInt32BE(3, 4);
disk.writeBigUInt64BE(2n * 1024n ** 3n, 24);
disk.write('golden content', 256);

async function fixture(t: TestContext) {
  const id = randomUUID(),
    folder = join(root, 'library-' + id);
  const engine = {
    run: async (_tool: string, args: string[]) => {
      if (args[0] === 'convert') await copyFile(args.at(-2)!, args.at(-1)!);
      return '{}';
    },
  } as Engine;
  const machines = new Machines(engine);
  const source = {
    ...createSchema.parse({ name: 'gold-source', diskGiB: 2, forwards: [{ host: 22111, guest: 8080 }] }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
    bootstrapped: true,
  };
  machines.records.set(id, source);
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'disk.qcow2'), disk);
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  await writeFile(
    join(vmDir(id), 'project.json'),
    JSON.stringify({ directory: '/workspace', environment: {} }),
  );
  const bundles = new Bundles(machines);
  const service = new GoldenImages(machines, bundles, folder, new Jobs('golden', join(folder, 'jobs')));
  t.after(() => service.close());
  const make = () =>
    service.action({ action: 'create', vmId: id, name: '干净环境', note: 'fixture', sourceReviewed: true });
  return { id, folder, machines, engine, service, bundles, make };
}

test('golden images persist a standalone template and create independent rekeying instances even after source deletion', async (t) => {
  const f = await fixture(t);
  const saved = await f.make();
  let view = await f.service.view();
  assert.equal(saved.kind, 'template');
  assert.equal(view.templates.length, 1);
  assert.equal(view.issues.length, 0);
  assert.equal(view.templates[0].sourceId, f.id);
  assert.ok(!JSON.stringify(view).includes(key.privateText));
  assert.equal((await f.service.action({ action: 'verify', id: saved.id })).kind, 'verified');
  f.machines.records.delete(f.id);
  const restored = new GoldenImages(f.machines, f.bundles, f.folder, new Jobs());
  t.after(() => restored.close());
  assert.equal((await restored.view()).templates[0].sha256, view.templates[0].sha256);
  const created = await restored.action({ action: 'instantiate', id: saved.id, name: 'from-golden' });
  assert.equal(created.kind, 'vm');
  assert.deepEqual(await readFile(join(vmDir(created.id), 'disk.qcow2')), disk);
  assert.deepEqual(f.machines.get(created.id).forwards, []);
  assert.notEqual(
    JSON.parse(await readFile(join(vmDir(created.id), 'identity.json'), 'utf8')).privateText,
    key.privateText,
  );
  assert.equal(f.machines.state(created.id), 'stopped');
  await restored.action({ action: 'delete', id: saved.id });
  assert.equal((await restored.view()).templates.length, 0);
  assert.deepEqual(await readFile(join(vmDir(created.id), 'disk.qcow2')), disk);
});

test('golden image hash and incomplete metadata failures never adopt a VM, and incomplete folders can be removed', async (t) => {
  const f = await fixture(t),
    saved = await f.make();
  const bundle = join(f.folder, saved.id, 'template.sakura');
  const bytes = await readFile(bundle);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(bundle, bytes);
  await assert.rejects(
    f.service.action({ action: 'instantiate', id: saved.id, name: 'corrupted' }),
    /SHA-256/,
  );
  assert.equal(f.machines.records.size, 1);
  await writeFile(join(f.folder, saved.id, 'manifest.json'), 'broken');
  assert.equal((await f.service.view()).issues.length, 1);
  await assert.rejects(f.make(), /损坏/);
  await f.service.action({ action: 'delete', id: saved.id });
  assert.equal((await f.service.view()).issues.length, 0);
});

test('golden image operations reject running and sandbox sources, require review, serialize work, and cancel incomplete output', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.action({ action: 'create', vmId: f.id, name: 'x', sourceReviewed: false }));
  f.machines.live.set(f.id, {} as any);
  await assert.rejects(f.make(), /停止/);
  f.machines.live.delete(f.id);
  f.machines.get(f.id).sandbox = {} as any;
  await assert.rejects(f.make(), /沙箱/);
  delete f.machines.get(f.id).sandbox;
  let entered!: () => void;
  const running = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.bundles.export = async (_id, _target, _headers, signal) => {
    entered();
    await new Promise<void>((_resolve, reject) =>
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
    );
    return '0'.repeat(64);
  };
  const abort = new AbortController();
  const pending = f.service.action(
    { action: 'create', vmId: f.id, name: 'cancel', sourceReviewed: true },
    abort.signal,
  );
  await running;
  await assert.rejects(f.service.action({ action: 'delete', id: randomUUID() }), /进行/);
  abort.abort();
  await assert.rejects(pending, /取消/);
  assert.equal((await f.service.view()).templates.length, 0);
  assert.equal((await f.service.view()).issues.length, 0);
  assert.equal(f.service.jobs.view('library')?.status, 'cancelled');
});

test('golden images preserve unrelated and linked files and recheck source lockdown immediately before publishing a derived VM', async (t) => {
  const f = await fixture(t),
    saved = await f.make();
  const folder = join(f.folder, saved.id);
  await writeFile(join(folder, 'user-notes.txt'), 'preserve');
  await assert.rejects(f.service.action({ action: 'delete', id: saved.id }), /其他文件/);
  assert.equal(await readFile(join(folder, 'user-notes.txt'), 'utf8'), 'preserve');
  await rm(join(folder, 'user-notes.txt'));
  const linked = join(f.folder, 'saved-copy');
  await link(join(folder, 'template.sakura'), linked);
  await assert.rejects(f.service.action({ action: 'verify', id: saved.id }), /链接/);
  await assert.rejects(f.service.action({ action: 'delete', id: saved.id }), /链接/);
  await rm(linked);
  let block = false;
  f.machines.requireUnlocked = () => {
    if (block) throw new Error('应急锁定');
  };
  const original = f.engine.run;
  f.engine.run = async (tool, args, options) => {
    const result = await original(tool, args, options);
    if (args[0] === 'info') block = true;
    return result;
  };
  await assert.rejects(
    f.service.action({ action: 'instantiate', id: saved.id, name: 'blocked' }),
    /应急锁定/,
  );
  assert.equal(f.machines.records.size, 1);
  block = false;
  f.engine.run = original;
  f.machines.maintenance = true;
  await assert.rejects(
    f.service.action({ action: 'instantiate', id: saved.id, name: 'maintenance' }),
    /维护/,
  );
  assert.equal(f.machines.records.size, 1);
});

test('golden library limits count before conversion and closed services cannot admit new work', async (t) => {
  const f = await fixture(t),
    saved = await f.make();
  const original = (await f.service.view()).templates[0];
  for (let count = 1; count < 16; count++) {
    const id = randomUUID(),
      directory = join(f.folder, id);
    await mkdir(directory);
    await copyFile(join(f.folder, saved.id, 'template.sakura'), join(directory, 'template.sakura'));
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...original, id }));
  }
  await assert.rejects(f.make(), /16/);
  assert.equal((await f.service.view()).templates.length, 16);
  await assert.rejects(f.service.action({ action: 'delete', id: '../' }));
  await f.service.close();
  await assert.rejects(f.service.action({ action: 'delete', id: saved.id }), /关闭/);
});
