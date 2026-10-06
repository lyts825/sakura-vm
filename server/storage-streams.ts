import { open } from 'node:fs/promises';
import { finished, pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { Readable, Transform, type Writable } from 'node:stream';
import { AppError } from '../shared/errors.ts';
import { storageRuntime, type StorageLease } from './storage-runtime.ts';

/** HTTP/file callers send headers only after admission and descriptor validation. */
export async function streamStoredFile(
  file: string,
  output: Writable,
  signal: AbortSignal,
  headers: (bytes: number) => void = () => {},
  lease?: StorageLease,
): Promise<void> {
  if (!lease)
    return storageRuntime.run(
      {
        owner: 'core:file-stream',
        taskId: 'file-stream:' + randomUUID(),
        label: 'Stream stored file',
        mode: 'read',
        transfer: 'outbound',
        paths: [file],
        buffers: 256 * 1024,
        files: 2,
        signal,
      },
      (owned) => streamStoredFile(file, output, signal, headers, owned),
    );
  lease.assertActive();
  signal.throwIfAborted();
  const handle = await open(file, 'r');
  let input: Readable | undefined;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new AppError('文件不可用', 409);
    signal.throwIfAborted();
    headers(info.size);
    input = info.size ? handle.createReadStream({ end: info.size - 1, signal }) : Readable.from([]);
    let bytes = 0;
    await pipeline(
      input,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          done(bytes > info.size ? new AppError('下载期间文件长度变化', 409) : null, chunk);
        },
        flush(done) {
          done(bytes !== info.size ? new AppError('下载期间文件长度变化', 409) : null);
        },
      }),
      output,
      { signal },
    );
  } finally {
    input?.destroy();
    if (input) await finished(input).catch(() => {});
    try {
      await handle.close();
    } catch (error) {
      lease.cleanupPending(error);
      throw error;
    }
    if (!output.writableFinished) output.destroy();
    await finished(output).catch(() => {});
  }
}
