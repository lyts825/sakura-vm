/**
 * 模块职责：流式发送已存储文件，校验打开文件身份与长度，防止下载期间替换产生失配。
 * Module purpose: Streams stored files from validated descriptors, checking length to prevent inconsistent delivery during replacement.
 */
import { open } from 'node:fs/promises';
import { finished, pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { Readable, Transform, type Writable } from 'node:stream';
import { AppError } from '../shared/errors.ts';
import { storageRuntime, type StorageLease } from './storage-runtime.ts';

/** HTTP/file callers send headers only after admission and descriptor validation. */
/**
 * 入口 / Entry: streamStoredFile.
 * 功能：在流式发送已存储文件中，执行此领域的具体处理步骤并返回其结果；本入口产生 `storageRuntime.run( { owner: 'core:file-stream', taskId: 'file-stream:' + randomUUID(), label: 'Stream stored file', mode: 'r…` 供上层消费（`storage-streams.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `storage-streams.ts`; this entry produces `storageRuntime.run( { owner: 'core:file-stream', taskId: 'file-stream:' + randomUUID(), label: 'Stream stored file', mode: 'r…` for its caller. Module context: Streams stored files from validated descriptors, checking length to prevent inconsistent delivery during replacement.
 * 处理：通过 `storageRuntime.run`, `randomUUID`, `lease.assertActive`, `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `storageRuntime.run`, `randomUUID`, `lease.assertActive`, `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!lease`; `input`; `!output.writableFinished`.
 * 输入 / Inputs: file: string; output: Writable; signal: AbortSignal; headers: (bytes: number) => void default=() => {}; lease: StorageLease optional
 * 输出 / Returns: Promise<void>；结果来自 / values from `storageRuntime.run( { owner: 'core:file-stream', taskId: 'file-stream:' + randomUUID(), label: 'Stream stored file', mode: 'r…`.
 * 副作用 / Effects: `handle.createReadStream`; `input.destroy`; `handle.close`; `output.destroy`; 更新 / updates `input`.
 * 拒绝 / Refusals: 条件 / conditions `!info.isFile()`; 异常 / errors `new AppError('文件不可用', 409)`; `error`.
 * 收尾：退出 try 区域时始终执行 `input?.destroy();`; `if (input) await finished(input).catch(() => {});`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `input?.destroy();`; `if (input) await finished(input).catch(() => {});`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
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
        /**
         * 入口 / Entry: streamStoredFile.transform.
         * 功能：在流式发送已存储文件中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`storage-streams.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `storage-streams.ts`; the calls and state transitions below complete the operation. Module context: Streams stored files from validated descriptors, checking length to prevent inconsistent delivery during replacement.
         * 处理：通过 `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `done`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: chunk: Buffer; _encoding; done
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 更新 / updates `bytes`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          done(bytes > info.size ? new AppError('下载期间文件长度变化', 409) : null, chunk);
        },
        /**
         * 入口 / Entry: streamStoredFile.flush.
         * 功能：在流式发送已存储文件中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`storage-streams.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `storage-streams.ts`; the calls and state transitions below complete the operation. Module context: Streams stored files from validated descriptors, checking length to prevent inconsistent delivery during replacement.
         * 处理：通过 `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `done`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: done
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
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
