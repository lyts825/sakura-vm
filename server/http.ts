import type { IncomingMessage } from 'node:http';
import { AppError } from '../shared/errors.ts';
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

export const DEFAULT_JSON_REQUEST_BYTES = 1500000;
const jsonBodies = new WeakMap<IncomingMessage, Promise<{ bytes: number; input: unknown }>>();

async function consumeJsonBody(req: IncomingMessage, maxBytes: number, signal?: AbortSignal) {
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
    return { bytes: size, input: JSON.parse(Buffer.concat(chunks).toString()) as unknown };
  } catch {
    throw new AppError('JSON 格式错误');
  }
}

/** A bounded preflight and the domain handler share one physical body read.
 * Every reader retains its own byte limit and cancellation check. The weak
 * cache is request-local and never persists bodies or credentials. */
export async function readJsonBody(req: IncomingMessage, maxBytes = DEFAULT_JSON_REQUEST_BYTES, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let pending = jsonBodies.get(req);
  if (!pending) {
    pending = consumeJsonBody(req, maxBytes, signal);
    jsonBodies.set(req, pending);
  }
  const body = await pending;
  signal?.throwIfAborted();
  if (body.bytes > maxBytes) throw new AppError('请求内容过大', 413);
  return structuredClone(body.input);
}
