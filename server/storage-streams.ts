import { open } from 'node:fs/promises';
import { finished, pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
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
  let input: ReturnType<typeof handle.createReadStream> | undefined;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new AppError('文件不可用', 409);
    signal.throwIfAborted();
    headers(info.size);
    input = handle.createReadStream({ end: Math.max(0, info.size - 1), signal });
    await pipeline(input, output, { signal });
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
