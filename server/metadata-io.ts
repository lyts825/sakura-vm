/**
 * 模块职责：提供持锁后的原子元数据替换原语；发布前重查授权及取消，不能重入同文件队列。
 * Module purpose: Atomically replaces metadata while the caller holds its file queue; authorization/cancellation are checked before publication.
 */
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { captureOperationCheck } from './operation-context.ts';
import { pluginAuthority, pluginCleanup } from './plugin-authority.ts';

/** 此原语不自行排队，调用方必须持有当前文件的 serializedMetadata 槽位。
 * 提交检查不能重新进入同文件队列，否则会等待自己持有的写入。 */
/**
 * 入口 / Entry: atomicMetadataWrite.
 * 功能：创建并落盘独占临时文件，在最终授权和取消检查通过后以 rename 发布。
 * Purpose: Creates and flushes an exclusive temporary file, publishing it with rename after final authority and cancellation checks.
 * 设计：调用者必须持有同文件队列；Windows 短暂句柄冲突在一秒期限内重试同一临时文件，finally 删除残留并记录清理失败。
 * Design: Caller must hold the same-file queue; transient Windows handle conflicts retry the same temporary file within a one-second deadline, and finally removes leftovers while tracking cleanup failure.
 * 输入 / Inputs: file: string; contents: string; beforeCommit: () => void | Promise<void> optional; markPublication: () => void default=() => {}; signal: AbortSignal optional
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `mkdir`; `writeFile`; `rename`; `rm`.
 * 拒绝 / Refusals: 条件 / conditions `process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException)?.code || '') || remai…`; 异常 / errors `error`.
 * 收尾：退出 try 区域时始终执行 `try { await rm(temp, { force: true }); } catch (error) { markPublication(); throw error; }`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `try { await rm(temp, { force: true }); } catch (error) { markPublication(); throw error; }`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `markPublication();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `markPublication();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function atomicMetadataWrite(
  file: string,
  contents: string,
  beforeCommit?: () => void | Promise<void>,
  markPublication: () => void = () => {},
  signal?: AbortSignal,
) {
  const instance = pluginAuthority(),
    cleaning = !!instance && pluginCleanup() === instance;
  const check = captureOperationCheck();
  if (!cleaning) instance?.check('metadata', true);
  await check();
  signal?.throwIfAborted();
  try {
    await mkdir(dirname(file), { recursive: true });
  } catch (error) {
    markPublication();
    throw error;
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    signal?.throwIfAborted();
    try {
      await writeFile(temp, contents, { mode: 0o600, flag: 'wx', flush: true });
    } catch (error) {
      markPublication();
      throw error;
    }
    const deadline = performance.now() + 1000;
    for (let attempt = 0; ; attempt++) {
      await beforeCommit?.();
      if (!cleaning) instance?.check('metadata', true);
      await check();
      // 异步提交检查期间仍可能收到取消，rename 前再次确认，防止取消后发布。
      signal?.throwIfAborted();
      try {
        await rename(temp, file);
        markPublication();
        break;
      } catch (error) {
        const remaining = deadline - performance.now();
        if (
          process.platform !== 'win32' ||
          !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException)?.code || '') ||
          remaining <= 0
        ) {
          markPublication();
          throw error;
        }
        // Windows 句柄占用可能短暂阻止替换；在期限内重试同一已落盘临时文件并保留原文件。
        await delay(Math.min(remaining, 25 * 2 ** Math.min(attempt, 3)), undefined, { signal });
      }
    }
  } finally {
    try {
      await rm(temp, { force: true });
    } catch (error) {
      markPublication();
      throw error;
    }
  }
}
