import type { IncomingMessage } from 'node:http';
import { AppError } from './model.ts';
import { MAX_TEXT_BYTES } from './files.ts';

// JSON can encode each content byte as a six-character \uXXXX escape.
export const MAX_TEXT_REQUEST_BYTES = MAX_TEXT_BYTES * 6 + 65536;

export function requestUrl(value: string | undefined, port: number): URL | null {
  try {
    return new URL(value || '/', `http://127.0.0.1:${port}`);
  } catch {
    return null;
  }
}

export async function readJsonBody(req: IncomingMessage, maxBytes = 1500000, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new AppError('需要 application/json 请求', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  const abort = () => {
    req.destroy(signal?.reason);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for await (const data of req) {
      size += data.length;
      if (size > maxBytes) throw new AppError('请求内容过大', 413);
      chunks.push(data);
    }
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new AppError('JSON 格式错误');
  }
}
