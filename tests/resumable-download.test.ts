import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { downloadManifest } from '../server/file-chunks.ts';
import { resumableDownload } from '../scripts/resumable-download.mjs';

const root = await mkdtemp(join(tmpdir(), 'sakura-download-test-'));
after(() => rm(root, { recursive: true, force: true }));
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

test('downloads resume verified local chunks after interruption and never overwrite an existing output', async () => {
  const data = Buffer.concat([Buffer.alloc(1024 ** 2, 3), Buffer.alloc(1024 ** 2, 8), Buffer.from('tail')]);
  const manifest = await downloadManifest(
    {
      download: async (_id: string, _path: string, target: any, headers: any) => {
        headers(data.length);
        await pipeline(Readable.from([data.subarray(0, 100), data.subarray(100)]), target);
      },
    } as any,
    'vm',
    '/file',
    new AbortController().signal,
  );
  assert.equal(manifest.sha256, sha(data));
  assert.equal(manifest.chunks.length, 3);
  let fail = true,
    requests: number[] = [];
  const api = async (path: string) => {
    const url = new URL('http://localhost' + path),
      index = Number(url.searchParams.get('chunk'));
    if (!url.searchParams.has('chunk')) return manifest;
    requests.push(index);
    if (fail && index === 1) throw new Error('connection lost');
    const bytes = data.subarray(
      index * manifest.chunkBytes,
      Math.min(data.length, (index + 1) * manifest.chunkBytes),
    );
    return { index, data: bytes.toString('base64'), sha256: sha(bytes) };
  };
  const output = join(root, 'download.bin');
  await assert.rejects(resumableDownload(api, 'vm', '/file', output), /connection lost/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  assert.equal((await readFile(output + '.sakura-part')).length, manifest.chunkBytes);
  fail = false;
  requests = [];
  const result = await resumableDownload(api, 'vm', '/file', output);
  assert.deepEqual(requests, [1, 2]);
  assert.equal(result.reusedChunks, 1);
  assert.deepEqual(await readFile(output), data);
  await assert.rejects(readFile(output + '.sakura-part.json'), { code: 'ENOENT' });
  await assert.rejects(resumableDownload(api, 'vm', '/file', output), /拒绝覆盖/);
});

test('a changed remote manifest refuses to reuse a partial download', async () => {
  const data = Buffer.from('previous'),
    output = join(root, 'changed.bin');
  const manifest = {
    path: '/file',
    size: data.length,
    chunkBytes: 1024 ** 2,
    sha256: sha(data),
    chunks: [sha(data)],
  };
  await writeFile(output + '.sakura-part.json', JSON.stringify({ vmId: 'vm', path: '/file', manifest }));
  await writeFile(output + '.sakura-part', data);
  await assert.rejects(
    resumableDownload(async () => ({ ...manifest, sha256: 'a'.repeat(64) }), 'vm', '/file', output),
    /远端文件已变化/,
  );
  assert.deepEqual(await readFile(output + '.sakura-part'), data);
});
