import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ResumableUploads, UPLOAD_CHUNK_BYTES } from '../server/resumable-uploads.ts';
import { previewFile, csvRows } from '../server/file-preview.ts';

const id = '11111111-1111-4111-8111-111111111111';
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

test('resumable uploads survive restart, verify chunks and commit idempotently', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-upload-test-'));
  const saved = new Map<string, Buffer>();
  let uploadCount = 0,
    failAfterWrite = false;
  const files: any = {
    upload: async (_id: string, path: string, source: Readable) => {
      const chunks = [];
      for await (const chunk of source) chunks.push(Buffer.from(chunk));
      const data = Buffer.concat(chunks);
      saved.set(path, data);
      uploadCount++;
      if (failAfterWrite) {
        failAfterWrite = false;
        throw new Error('lost response');
      }
      return { bytes: data.length };
    },
    info: async (_id: string, path: string) => ({ size: saved.get(path)?.length }),
    download: async (_id: string, path: string, target: any) => {
      if (!saved.has(path)) throw new Error('missing');
      await pipeline(Readable.from(saved.get(path)!), target);
    },
  };
  const signal = new AbortController().signal;
  try {
    const parts = [Buffer.alloc(UPLOAD_CHUNK_BYTES, 7), Buffer.from('last chunk')];
    const request = {
      path: '/workspace/file.bin',
      size: parts.reduce((sum, part) => sum + part.length, 0),
      chunks: parts.map(sha),
    };
    const service = new ResumableUploads(files, directory);
    const session = await service.create(id, request);
    await assert.rejects(service.chunk(id, session.id, 0, Readable.from(Buffer.from('bad')), signal), /校验/);
    await service.chunk(id, session.id, 0, Readable.from(parts[0]), signal);
    const restarted = new ResumableUploads(files, directory);
    const resumed = await restarted.create(id, request);
    assert.equal(resumed.id, session.id);
    assert.deepEqual(resumed.received, [0]);
    await assert.rejects(restarted.commit(id, session.id, signal), /不完整/);
    await restarted.chunk(id, session.id, 1, Readable.from(parts[1]), signal);
    failAfterWrite = true;
    await assert.rejects(restarted.commit(id, session.id, signal), /lost response/);
    const done = await new ResumableUploads(files, directory).commit(id, session.id, signal);
    assert.equal(done.sha256, sha(Buffer.concat(parts)));
    assert.equal(uploadCount, 1);
    assert.deepEqual(saved.get(request.path), Buffer.concat(parts));
    await restarted.commit(id, session.id, signal);
    assert.equal(uploadCount, 1);
    saved.set(request.path, Buffer.from('external edit'));
    assert.notEqual((await restarted.create(id, request)).id, session.id);
    await assert.rejects(restarted.commit(id, session.id, signal), /发生变化/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('persisted chunk tampering is detected before writing the guest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-upload-tamper-'));
  let writes = 0;
  try {
    const service = new ResumableUploads(
      {
        upload: async () => {
          writes++;
          return { bytes: 4 };
        },
      } as any,
      directory,
    );
    const payload = Buffer.from('good');
    const session = await service.create(id, {
      path: '/workspace/file',
      size: payload.length,
      chunks: [sha(payload)],
    });
    await service.chunk(id, session.id, 0, Readable.from(payload), new AbortController().signal);
    await writeFile(join(directory, id, session.id, '0.chunk'), 'evil');
    await assert.rejects(service.commit(id, session.id, new AbortController().signal), /校验失败/);
    assert.equal(writes, 0);
    await assert.rejects(service.remove(id, '../outside'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('binary preview identifies content and parses quoted CSV without evaluating cells', () => {
  assert.equal(previewFile('not-an-image.txt', Buffer.from('89504e470d0a1a0a', 'hex')).kind, 'image');
  assert.equal(previewFile('document.pdf', Buffer.from('%PDF-1.7\n')).kind, 'pdf');
  assert.deepEqual(csvRows('a,"b,c","line\nnext"\r\n1,"quoted ""value""",=CMD()').rows, [
    ['a', 'b,c', 'line\nnext'],
    ['1', 'quoted "value"', '=CMD()'],
  ]);
  assert.equal(previewFile('large.bin', Buffer.from('head'), 20 * 1024 ** 2).kind, 'hex');
  assert.throws(() => previewFile('bad.zip', Buffer.alloc(30)), /ZIP/);
  assert.throws(() => previewFile('bad.tar', Buffer.alloc(1024, 1)), /TAR/);
});
