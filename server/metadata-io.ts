import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { captureOperationCheck } from './operation-context.ts';
import { pluginAuthority, pluginCleanup } from './plugin-authority.ts';

/** Unqueued primitive: callers MUST hold serializedMetadata for this file.
 * A commit guard must not enter this file's queue again. */
export async function atomicMetadataWrite(
  file: string,
  contents: string,
  beforeCommit?: () => void | Promise<void>,
  markPublication: () => void = () => {},
) {
  const instance = pluginAuthority(),
    cleaning = !!instance && pluginCleanup() === instance;
  const check = captureOperationCheck();
  if (!cleaning) instance?.check('metadata', true);
  await check();
  try {
    await mkdir(dirname(file), { recursive: true });
  } catch (error) {
    markPublication();
    throw error;
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
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
        // Windows can briefly deny replacement while another handle is open.
        // Keep the original file and this exact flushed temporary file intact.
        await delay(Math.min(remaining, 25 * 2 ** Math.min(attempt, 3)));
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
