import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import type { VMRecord } from '../server/model.ts';

const base = resolve('.data/machines-save-test-temp');
await fs.mkdir(base, { recursive: true });
assert.equal(await fs.realpath(base), base);
assert.equal((await fs.lstat(base)).isSymbolicLink(), false);
const root = await fs.mkdtemp(join(base, 'machines-save-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { DATA, createSchema } = await import('../server/model.ts');
assert.equal(DATA, root);
const file = join(root, 'machines.json'), sentinelFile = file + '.tmp';
const sentinel = 'an unrelated pre-existing owned temporary file';
const originalRename = fs.rename, originalWriteFile = fs.writeFile;
after(async () => {
  assert.equal(dirname(resolve(root)), base);
  assert.equal(await fs.realpath(root), root);
  assert.equal((await fs.lstat(root)).isSymbolicLink(), false);
  assert.ok(basename(root).startsWith('machines-save-'));
  await fs.rm(root, { recursive: true, force: true });
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(yes => { release = yes; });
  return { promise, release };
}
const save = (machines: MachineType) => (machines as unknown as { save(): Promise<void> }).save();
async function fixture() {
  let closes = 0;
  const machines = new Machines({ runtime: { close: async () => { ++closes; } } } as unknown as Engine);
  const record: VMRecord = { ...createSchema.parse({ name: 'old-owned',
    forwards: [{ name: 'old-nested', host: 24601, guest: 24602 }] }),
    id: randomUUID(), createdAt: new Date().toISOString(), snapshots: [], bootstrapped: true };
  machines.records.set(record.id, record);
  const old = JSON.stringify([record], null, 2);
  await originalWriteFile(file, old);
  await originalWriteFile(sentinelFile, sentinel);
  return { machines, record, old, closes: () => closes };
}

test('machine saves publish admission-time nested snapshots in order and close drains the pending publication', async t => {
  const f = await fixture(), reached = [gate(), gate()], allowed = [gate(), gate()];
  const sources = new Map<string, number>(), published: VMRecord[][] = [];
  const operations: Promise<void>[] = [];
  let writes = 0;
  try {
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]).startsWith(file + '.')) {
        ++writes;
        assert.deepEqual(args[2], { mode: 0o600, flag: 'wx', flush: true });
        assert.notEqual(String(args[0]), sentinelFile);
      }
      return originalWriteFile(...args);
    });
    t.mock.method(fs, 'rename', async (source: string, destination: string) => {
      assert.equal(destination, file);
      let index = sources.get(source);
      if (index === undefined) {
        index = sources.size; sources.set(source, index);
        assert.ok(source.startsWith(file + '.') && source.endsWith('.tmp'));
        assert.notEqual(source, sentinelFile);
        published[index] = JSON.parse(await fs.readFile(source, 'utf8')) as VMRecord[];
        reached[index].release();
        await allowed[index].promise;
      }
      return originalRename(source, destination);
    });
    syncBuiltinESMExports();
    f.record.name = 'first-owned'; f.record.forwards[0].name = 'first-nested';
    operations.push(save(f.machines)); void operations[0].catch(() => {});
    await reached[0].promise;
    f.record.name = 'second-owned'; f.record.forwards[0].name = 'second-nested';
    operations.push(save(f.machines)); void operations[1].catch(() => {});
    f.record.name = 'not-yet-saved'; f.record.forwards[0].name = 'not-yet-saved-nested';
    await delay(15);
    assert.equal(sources.size, 1); assert.equal(writes, 1);
    assert.equal(await fs.readFile(file, 'utf8'), f.old);
    allowed[0].release(); await operations[0]; await reached[1].promise;
    const first = JSON.parse(await fs.readFile(file, 'utf8')) as VMRecord[];
    assert.equal(first[0].name, 'first-owned'); assert.equal(first[0].forwards[0].name, 'first-nested');
    const closing = f.machines.close();
    await delay(15); assert.equal(f.closes(), 0);
    allowed[1].release(); await operations[1]; await closing;
    const next = JSON.parse(await fs.readFile(file, 'utf8')) as VMRecord[];
    assert.equal(next[0].name, 'second-owned'); assert.equal(next[0].forwards[0].name, 'second-nested');
    assert.equal(published[0][0].name, 'first-owned'); assert.equal(published[1][0].name, 'second-owned');
    assert.equal(writes, 2); assert.equal(sources.size, 2); assert.equal(f.closes(), 1);
    assert.equal(await fs.readFile(sentinelFile, 'utf8'), sentinel);
    assert.deepEqual((await fs.readdir(root)).sort(), [basename(file), basename(sentinelFile)].sort());
  } finally {
    for (const item of allowed) item.release();
    await Promise.allSettled(operations);
    t.mock.restoreAll(); syncBuiltinESMExports(); await f.machines.close();
  }
});

test('a sustained own Windows read handle preserves the complete machine list, reports failure and permits a later queued save after close',
  { skip: process.platform !== 'win32' }, async t => {
    const f = await fixture();
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(file, 'r');
      const identity = await handle.stat(), started = performance.now();
      f.record.name = 'new-owned';
      let failure: NodeJS.ErrnoException | undefined;
      await assert.rejects(save(f.machines), error => {
        failure = error as NodeJS.ErrnoException;
        assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(failure.code || ''));
        assert.equal(failure.syscall, 'rename');
        assert.equal((failure as NodeJS.ErrnoException & { dest: string }).dest, file);
        assert.notEqual(failure.path, sentinelFile);
        return true;
      });
      const elapsedMs = performance.now() - started;
      assert.ok(elapsedMs >= 900 && elapsedMs < 5000, `bounded machine save elapsed ${elapsedMs}ms`);
      assert.equal(await fs.readFile(file, 'utf8'), f.old);
      const retained = await fs.stat(file);
      assert.equal(retained.dev, identity.dev); assert.equal(retained.ino, identity.ino);
      assert.equal(await fs.readFile(sentinelFile, 'utf8'), sentinel);
      assert.deepEqual((await fs.readdir(root)).sort(), [basename(file), basename(sentinelFile)].sort());
      await handle.close(); handle = undefined;
      await save(f.machines);
      assert.equal((JSON.parse(await fs.readFile(file, 'utf8')) as VMRecord[])[0].name, 'new-owned');
      assert.equal(await fs.readFile(sentinelFile, 'utf8'), sentinel);
      assert.deepEqual((await fs.readdir(root)).sort(), [basename(file), basename(sentinelFile)].sort());
      t.diagnostic(JSON.stringify({ ownNativeReadHandle: true, elapsedMs: Math.round(elapsedMs), code: failure!.code,
        retainedDevice: identity.dev, retainedInode: identity.ino, recoveryAfterClose: true }));
    } finally { await handle?.close(); await f.machines.close(); }
  });

test('a non-retry machine publication error is preserved and does not poison a later save or modify another temporary file', async t => {
  const f = await fixture(), failure = Object.assign(new Error('owned machine publication failure'), { code: 'EIO' });
  let attempts = 0;
  try {
    t.mock.method(fs, 'rename', async () => { ++attempts; throw failure; }); syncBuiltinESMExports();
    f.record.name = 'failed-owned';
    await assert.rejects(save(f.machines), error => error === failure);
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(file, 'utf8'), f.old);
    assert.equal(await fs.readFile(sentinelFile, 'utf8'), sentinel);
    assert.deepEqual((await fs.readdir(root)).sort(), [basename(file), basename(sentinelFile)].sort());
    t.mock.restoreAll(); syncBuiltinESMExports();
    f.record.name = 'recovered-owned'; await save(f.machines);
    assert.equal((JSON.parse(await fs.readFile(file, 'utf8')) as VMRecord[])[0].name, 'recovered-owned');
    assert.equal(await fs.readFile(sentinelFile, 'utf8'), sentinel);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.machines.close(); }
});
