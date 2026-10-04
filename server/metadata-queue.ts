import { createHash } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { resolve } from 'node:path';
import { captureOperationCheck } from './operation-context.ts';
import { pluginAuthority, pluginCleanup } from './plugin-authority.ts';
import { hostRuntime } from './host-runtime/index.ts';

type Queue = { tail: Promise<unknown>; pending: number; failure?: unknown };
const queues = new Map<string, Queue>();
let pending = 0;
export const metadataQueueLimits = Object.freeze({ perFile: 128, pending: 1024, files: 1024 });
/** Counts and opaque file identities only; never expose stored values or error messages. */
export function metadataQueueSnapshot() {
  return {
    limits: metadataQueueLimits,
    pending,
    files: [...queues.entries()].map(([key, state]) => ({
      key: createHash('sha256').update(key).digest('hex'),
      pending: state.pending,
      unconfirmedWrite: state.failure !== undefined,
    })),
  };
}

/** Lexical path aliases and Windows case aliases share a writer. This is an
 * in-process coordinator, not a cross-process or symlink/hardlink lock. */
export function metadataKey(file: string) {
  const path = resolve(file);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

export function serializedMetadata<T>(
  file: string,
  write: boolean,
  work: (markPublication: () => void) => Promise<T>,
): Promise<T> {
  const instance = pluginAuthority(),
    cleaning = !!instance && pluginCleanup() === instance;
  const check = captureOperationCheck();
  try {
    if (!cleaning) instance?.check('metadata', true);
  } catch (error) {
    return Promise.reject(error);
  }
  const key = metadataKey(file);
  let queue = queues.get(key);
  if (
    pending >= metadataQueueLimits.pending ||
    (queue?.pending || 0) >= metadataQueueLimits.perFile ||
    (!queue && queues.size >= metadataQueueLimits.files)
  )
    return Promise.reject(new AppError('元数据写入队列已满，请稍后重试', 503, 'METADATA_QUEUE_FULL'));
  if (!queue) {
    queue = { tail: Promise.resolve(), pending: 0 };
    queues.set(key, queue);
  }
  const state = queue;
  const lease = instance
    ? hostRuntime.register({
        owner: instance.owner,
        kind: 'metadata',
        label: write ? '元数据写入' : '元数据读取',
        lane: cleaning ? 'control' : 'background',
        identity: instance.resourceIdentity,
      })
    : undefined;
  state.pending++;
  pending++;
  let publishedOrIoFailed = false;
  const operation = state.tail
    .catch(() => {})
    .then(async () => {
      if (!cleaning) instance?.check('metadata', true);
      await check();
      return work(() => {
        publishedOrIoFailed = true;
      });
    });
  instance?.scope.observe(operation);
  // Keep physical publication failures for flush(), but not refused edits, CAS
  // conflicts or cancellation before disk I/O. Rejections never poison retries.
  state.tail = operation
    .then(
      () => {
        if (write) state.failure = undefined;
      },
      (error) => {
        if (write && publishedOrIoFailed) state.failure = error;
      },
    )
    .finally(() => {
      lease?.release();
      state.pending--;
      pending--;
      if (!state.pending && state.failure === undefined && queues.get(key) === state) queues.delete(key);
    });
  return operation;
}

export async function flushMetadataFile(file: string) {
  const state = queues.get(metadataKey(file));
  if (!state) return;
  await state.tail;
  if (state.failure !== undefined) throw state.failure;
}

export async function flushMetadata() {
  const pending = [...queues.values()];
  await Promise.all(pending.map((state) => state.tail));
  const failures = pending.filter((state) => state.failure !== undefined).map((state) => state.failure);
  if (failures.length) throw new AggregateError(failures, 'Metadata writes are not confirmed');
}
