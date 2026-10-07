/**
 * 模块职责：按规范化文件路径串行元数据操作；保留物理写入失败供 flush 核验且允许后续重试。
 * Module purpose: Serializes operations by canonical file key, retaining physical publication errors for flush without poisoning later retries.
 */
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
/** 诊断只暴露计数及不透明文件标识，不发布存储值或原始错误消息。 */
/**
 * 入口 / Entry: metadataQueueSnapshot.
 * 功能：返回有界队列计数和文件标识哈希，避免诊断暴露路径或持久值。
 * Purpose: Returns bounded queue counts and hashed file identifiers without exposing paths or durable values.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `{ limits: metadataQueueLimits, pending, files: [...queues.entries()].map(([key, state]) => ({ key: createHash('sha256').updat…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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

/** 规范化路径别名及 Windows 大小写共用写入队列；此协调仅覆盖本进程，不能充当物理文件锁。 */
/**
 * 入口 / Entry: metadataKey.
 * 功能：合并路径别名以及 Windows 大小写差异，生成进程内元数据队列键。
 * Purpose: Merges path aliases and Windows case variants into the process-local metadata queue key.
 * 输入 / Inputs: file: string
 * 输出 / Returns: `process.platform === 'win32' ? path.toLowerCase() : path`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function metadataKey(file: string) {
  const path = resolve(file);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

/**
 * 入口 / Entry: serializedMetadata.
 * 功能：在有界同文件队列内执行元数据工作，并捕获准入授权与可追踪的物理发布失败。
 * Purpose: Runs metadata work in a bounded same-file queue, capturing admission authority and tracked physical-publication failures.
 * 设计：旧队列错误不阻断重试；只有 mark 后的写失败被保留，成功写清除此失败，读取不会清除失败。
 * Design: Earlier queue rejection does not block retries; only write failures after mark are retained, a successful write clears them and reads do not.
 * 输入 / Inputs: file: string; write: boolean; work: (markPublication: () => void) => Promise<T>
 * 输出 / Returns: Promise<T>；结果来自 / values from `Promise.reject(error)`; `Promise.reject(new AppError('元数据写入队列已满，请稍后重试', 503, 'METADATA_QUEUE_FULL'))`; `operation`.
 * 副作用 / Effects: `queues.set`; `hostRuntime.register`; `instance.scope.observe`; 更新 / updates `queue`, `state.tail`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return Promise.reject(error);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return Promise.reject(error);`; these statements determine whether a failure is absorbed or rejected again.
 */
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
  // flush 保留已开始物理发布后的失败；授权拒绝、条件冲突和 I/O 前取消不污染后续重试。
  /**
   * 入口 / Entry: serializedMetadata.callback@92.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（operation.then().finally）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (operation.then().finally).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `lease.release`; `queues.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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

/**
 * 入口 / Entry: flushMetadataFile.
 * 功能：等待指定规范化文件队列，若该文件仍有未确认写入则抛出原失败。
 * Purpose: Waits for one normalized file queue and rethrows its retained unconfirmed-write failure.
 * 输入 / Inputs: file: string
 * 输出 / Returns: `void`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `state.failure !== undefined`; 异常 / errors `state.failure`.
 */
export async function flushMetadataFile(file: string) {
  const state = queues.get(metadataKey(file));
  if (!state) return;
  await state.tail;
  if (state.failure !== undefined) throw state.failure;
}

/**
 * 入口 / Entry: flushMetadata.
 * 功能：等待调用时捕获的全部队列，并聚合其中尚未确认的写入失败。
 * Purpose: Waits for all queues captured at invocation and aggregates their retained unconfirmed-write failures.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `failures.length`; 异常 / errors `new AggregateError(failures, 'Metadata writes are not confirmed')`.
 */
export async function flushMetadata() {
  const pending = [...queues.values()];
  await Promise.all(pending.map((state) => state.tail));
  const failures = pending.filter((state) => state.failure !== undefined).map((state) => state.failure);
  if (failures.length) throw new AggregateError(failures, 'Metadata writes are not confirmed');
}
