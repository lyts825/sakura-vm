/**
 * 模块职责：记录短时间内的启动失败并熔断重复启动，支持检查后的显式复位。
 */
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import { metadataFile } from './metadata-store.ts';

const WINDOW = 300000,
  LIMIT = 5;
const schema = z.object({ attempts: z.array(z.number().int().nonnegative()).max(100) }).strict();
const file = (id: string) => join(vmDir(id), 'boot-guard.json');
const store = (id: string) => metadataFile(file(id), () => ({ attempts: [] as number[] }), schema.parse);
function status(saved: { attempts: number[] }, now: number) {
  const attempts = saved.attempts.filter((at) => at > now - WINDOW && at <= now);
  return {
    attempts,
    failures: attempts.length,
    limit: LIMIT,
    windowSeconds: WINDOW / 1000,
    blocked: attempts.length >= LIMIT,
    retryAt: attempts.length >= LIMIT ? new Date(attempts[0] + WINDOW).toISOString() : null,
  };
}
export async function bootGuardStatus(id: string, now = Date.now()) {
  return status((await store(id).read()).value, now);
}
export async function recordBootAttempt(id: string, now = Date.now()) {
  await store(id).update((saved) => {
    const state = status(saved, now);
    if (state.blocked)
      throw new AppError(
        '该发行版在 5 分钟内连续启动失败；请检查日志后重置熔断，或等待 ' + state.retryAt,
        409,
        'BOOT_CIRCUIT_OPEN',
      );
    saved.attempts = [...state.attempts, now];
  });
}
export async function resetBootGuard(id: string) {
  await store(id).replace({ attempts: [] });
}
