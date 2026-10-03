import { parentPort, workerData } from 'node:worker_threads';
import { previewFile } from './file-preview.ts';
import { AppError } from '../shared/errors.ts';

try {
  if (workerData?.task !== 'file-preview' || typeof workerData.path !== 'string' ||
      !(workerData.data instanceof Uint8Array) || workerData.data.byteLength > 16 * 1024 ** 2 ||
      !Number.isSafeInteger(workerData.size) || workerData.size < workerData.data.byteLength)
    throw new AppError('计算输入无效', 400, 'COMPUTE_INPUT');
  const data = Buffer.from(workerData.data.buffer, workerData.data.byteOffset, workerData.data.byteLength);
  parentPort!.postMessage({ ok: true, result: previewFile(workerData.path, data, workerData.size) });
} catch (error) {
  parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error),
    ...(error instanceof AppError ? { status: error.status, code: error.code } : {}) });
}
