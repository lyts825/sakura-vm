import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { MetadataStore, metadataKey } from '../server/metadata-store.ts';

test('a fresh process resumes the same JSON revision and commits without sidecars or queue state', async (t) => {
  const { root, file, store } = await fixture(t);
  const saved = await store.replace({ count: 5, entries: ['before-restart'] });
  const script = `const { MetadataStore } = await import(process.argv[1]);
const store = new MetadataStore(process.argv[2], { fallback: () => ({ count: 0, entries: [] }) });
const before = await store.read();
await store.update(value => { value.count++; value.entries.push('after-restart'); }, { expectedRevision: before.revision });
await store.flush(); process.stdout.write(JSON.stringify(before));`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      script,
      new URL('../server/metadata-store.ts', import.meta.url).href,
      file,
    ],
    { windowsHide: true },
  );
  assert.deepEqual(JSON.parse(stdout), saved);
  assert.deepEqual((await store.read()).value, { count: 6, entries: ['before-restart', 'after-restart'] });
  assert.deepEqual(await readdir(root), ['state.json']);
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'sakura-metadata-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  const file = join(root, 'state.json');
  const store = new MetadataStore(file, { fallback: () => ({ count: 0, entries: [] as string[] }) });
  return { root, file, store };
}

test('metadata writers share normalized keys and serialize complete read-modify-write transactions', async (t) => {
  const { root, file, store } = await fixture(t);
  const alias = new MetadataStore(join(root, 'unused', '..', 'state.json'), {
    fallback: () => ({ count: 0, entries: [] as string[] }),
  });
  await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      (index % 2 ? store : alias).update(async (value) => {
        const before = value.count;
        await Promise.resolve();
        value.count = before + 1;
        value.entries.push(String(index));
      }),
    ),
  );
  await store.flush();
  const result = await store.read();
  assert.equal(result.value.count, 40);
  assert.equal(new Set(result.value.entries).size, 40);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), result.value, 'No JSON envelope is introduced');
  if (process.platform === 'win32') assert.equal(metadataKey(file), metadataKey(file.toUpperCase()));
  assert.deepEqual(await readdir(root), ['state.json']);
});

test('replace captures at admission while unrelated files continue to publish', async (t) => {
  const { root, store } = await fixture(t);
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>((done) => {
    entered = done;
  });
  const gate = new Promise<void>((done) => {
    finish = done;
  });
  const first = store.update(async () => {
    entered();
    await gate;
  });
  await ready;
  const value = { count: 7, entries: ['captured'] };
  const replacement = store.replace(value);
  value.count = 999;
  value.entries.push('later');
  const independent = new MetadataStore(join(root, 'other.json'), { fallback: () => 0 });
  await independent.replace(1);
  assert.equal((await independent.read()).value, 1);
  finish();
  await first;
  await replacement;
  assert.deepEqual((await store.read()).value, { count: 7, entries: ['captured'] });
});

test('content revisions survive reopening and refuse stale or externally changed publications', async (t) => {
  const { file, store } = await fixture(t);
  const missing = await store.read();
  assert.equal(missing.revision, 'missing');
  const initial = await store.replace({ count: 1, entries: [] }, { expectedRevision: missing.revision });
  const reopened = new MetadataStore(file, { fallback: () => ({ count: 0, entries: [] as string[] }) });
  assert.equal((await reopened.read()).revision, initial.revision);
  await reopened.update(
    (value) => {
      value.count++;
    },
    { expectedRevision: initial.revision },
  );
  await assert.rejects(store.replace({ count: 9, entries: [] }, { expectedRevision: initial.revision }), {
    code: 'METADATA_REVISION_CONFLICT',
  });
  assert.equal((await store.read()).value.count, 2);
  const before = await store.read();
  await writeFile(file, '{"count":3,"entries":[]}');
  await assert.rejects(
    store.update(
      (value) => {
        value.count++;
      },
      { expectedRevision: before.revision },
    ),
    { code: 'METADATA_REVISION_CONFLICT' },
  );
  await store.update((value) => {
    value.count++;
  });
  await store.flush();
  assert.equal((await store.read()).value.count, 4);
});

test('failed edits and publication errors remain visible to flush, but do not poison retries', async (t) => {
  const { root, store } = await fixture(t);
  await store.replace({ count: 1, entries: [] });
  await assert.rejects(
    store.update((value) => {
      value.count = 90;
      throw new Error('edit refused');
    }),
    /edit refused/,
  );
  assert.equal((await store.read()).value.count, 1);
  await assert.rejects(store.flush(), /edit refused/);
  await store.update((value) => {
    value.count++;
  });
  await store.flush();
  const target = join(root, 'blocked.json');
  await mkdir(target);
  const blocked = new MetadataStore(target, { fallback: () => 0 });
  await assert.rejects(blocked.replace(1));
  await assert.rejects(blocked.flush());
  assert.ok(!(await readdir(root)).some((file) => file.endsWith('.tmp')));
  await rm(target, { recursive: true });
  await blocked.replace(2);
  await blocked.flush();
  assert.equal((await blocked.read()).value, 2);
});

test('queued cancellation and invalid JSON never silently publish fallback state', async (t) => {
  const { file, store } = await fixture(t);
  const abort = new AbortController();
  let finish!: () => void;
  const gate = new Promise<void>((done) => {
    finish = done;
  });
  const first = store.update(async (value) => {
    await gate;
    value.count = 5;
  });
  const cancelled = store.replace({ count: 9, entries: [] }, { signal: abort.signal });
  abort.abort(new Error('cancelled before publication'));
  finish();
  await first;
  await assert.rejects(cancelled, /cancelled before publication/);
  assert.equal((await store.read()).value.count, 5);
  await writeFile(file, '{damaged');
  await assert.rejects(store.read(), SyntaxError);
  await assert.rejects(
    store.update((value) => {
      value.count++;
    }),
    SyntaxError,
  );
  assert.equal(await readFile(file, 'utf8'), '{damaged');
  await store.replace({ count: 6, entries: [] });
  await store.flush();
});
