import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { readVersionedStore, writeVersionedStore } from '../server/plugin-data.ts';
import { MetadataStore } from '../server/metadata-store.ts';

test('concurrent version writers cannot downgrade and preserve each exact recovery generation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-plugin-versions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'data.json'),
    schema = z.object({ name: z.string() });
  const original = '{"schemaVersion":1,"data":{"name":"initial"}}';
  await writeFile(file, original);
  const values = [{ name: 'v2' }, { name: 'v3' }, { name: 'stale' }];
  const outcomes = await Promise.allSettled(
    values.map((value, index) => writeVersionedStore(file, [2, 3, 2][index], schema, value)),
  );
  assert.deepEqual(
    outcomes.map((item) => item.status),
    ['fulfilled', 'fulfilled', 'rejected'],
  );
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schemaVersion: 3, data: values[1] });
  assert.equal(await readFile(`${file}.v1.bak`, 'utf8'), original);
  assert.deepEqual(JSON.parse(await readFile(`${file}.v2.bak`, 'utf8')), {
    schemaVersion: 2,
    data: values[0],
  });
  await new MetadataStore(file, { fallback: () => null }).flush();
});

test('plugin data migrates only in memory until a write, retaining a recovery copy', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sakura-plugin-data-'));
  const file = join(folder, 'commands.json');
  const schema = z.object({ names: z.array(z.string()) }).strict();
  const original = JSON.stringify(['build', 'test']);
  try {
    await writeFile(file, original);
    const value = await readVersionedStore(file, 1, schema, () => ({ names: [] }), {
      0: (raw) => ({ names: raw }),
    });
    assert.deepEqual(value, { names: ['build', 'test'] });
    assert.equal(await readFile(file, 'utf8'), original);
    await writeVersionedStore(file, 1, schema, value);
    assert.equal(await readFile(`${file}.v0.bak`, 'utf8'), original);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schemaVersion: 1, data: value });
    await assert.rejects(readVersionedStore(file, 0, schema, () => ({ names: [] })));
    await writeFile(file, JSON.stringify({ schemaVersion: 2, data: value }));
    await assert.rejects(
      readVersionedStore(file, 1, schema, () => ({ names: [] })),
      /版本过新/,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
