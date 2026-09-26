import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { AppError } from './model.ts';
import type { Files } from './files.ts';

export const DOWNLOAD_CHUNK_BYTES = 1024 ** 2;
export async function downloadManifest(files: Files, id: string, path: string, signal: AbortSignal) {
  const whole = createHash('sha256'),
    chunks: string[] = [];
  let pending = Buffer.alloc(0),
    size = 0,
    expected = 0;
  await files.download(
    id,
    path,
    new Writable({
      write(raw: Buffer, _encoding, done) {
        whole.update(raw);
        size += raw.length;
        pending = Buffer.concat([pending, raw]);
        while (pending.length >= DOWNLOAD_CHUNK_BYTES) {
          chunks.push(createHash('sha256').update(pending.subarray(0, DOWNLOAD_CHUNK_BYTES)).digest('hex'));
          pending = pending.subarray(DOWNLOAD_CHUNK_BYTES);
        }
        done();
      },
    }),
    (bytes) => {
      expected = bytes;
    },
    signal,
  );
  if (size !== expected) throw new AppError('生成清单时文件长度变化，请重试', 409);
  if (pending.length) chunks.push(createHash('sha256').update(pending).digest('hex'));
  return { path, size, chunkBytes: DOWNLOAD_CHUNK_BYTES, sha256: whole.digest('hex'), chunks };
}
