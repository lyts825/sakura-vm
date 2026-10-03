import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { singleAppAssetNames, singleAppSources } from '../server/single-app-assets.ts';

test('SingleApp immutable three-file bundle rejects changed, missing and reordered source authority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-single-app-assets-'));
  try {
    const digest = createHash('sha256'), files = [];
    for (const name of singleAppAssetNames) {
      const raw = await readFile(resolve('native/single-app', name)); digest.update(name).update(raw);
      files.push({ name, size: raw.length, sha256: createHash('sha256').update(raw).digest('hex') });
      await writeFile(join(directory, name), raw);
    }
    const manifest = { version: 1, build: digest.digest('hex'), files };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    const accepted = await singleAppSources(directory);
    assert.equal(accepted.directory, '/usr/local/lib/sakura-single-app/' + manifest.build);
    assert.deepEqual([...accepted.files.keys()], [...singleAppAssetNames]);
    await writeFile(join(directory, 'controller.py'), 'changed source');
    await assert.rejects(singleAppSources(directory), (error: unknown) => (error as { code: string }).code === 'SINGLE_APP_SOURCE_CHANGED');
    await writeFile(join(directory, 'controller.py'), accepted.files.get('controller.py')!);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, build: '0'.repeat(64) }));
    await assert.rejects(singleAppSources(directory), /固定源码版本不符/);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, files: [...manifest.files].reverse() }));
    await assert.rejects(singleAppSources(directory));
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await rm(join(directory, 'directory-view.py'));
    await assert.rejects(singleAppSources(directory), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
  } finally {
    const path = await realpath(directory);
    assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith('sakura-single-app-assets-'));
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
