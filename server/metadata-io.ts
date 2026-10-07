/**
 * 模块职责：提供持锁后的原子元数据替换原语；发布前重查授权及取消，不能重入同文件队列。
 */
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { captureOperationCheck } from './operation-context.ts';
import { pluginAuthority, pluginCleanup } from './plugin-authority.ts';

/** 此原语不自行排队，调用方必须持有当前文件的 serializedMetadata 槽位。
 * 提交检查不能重新进入同文件队列，否则会等待自己持有的写入。 */
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
