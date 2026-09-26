import { join } from 'node:path';
import { z } from 'zod';
import { AppError, vmDir } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

const WINDOW = 300000,
  LIMIT = 5;
const schema = z.object({ attempts: z.array(z.number().int().nonnegative()).max(100) }).strict();
const file = (id: string) => join(vmDir(id), 'boot-guard.json');
export async function bootGuardStatus(id: string, now = Date.now()) {
  const saved = schema.parse(await readStore(file(id), () => ({ attempts: [] })));
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
export async function recordBootAttempt(id: string, now = Date.now()) {
  const state = await bootGuardStatus(id, now);
  if (state.blocked)
    throw new AppError(
      '该发行版在 5 分钟内连续启动失败；请检查日志后重置熔断，或等待 ' + state.retryAt,
      409,
      'BOOT_CIRCUIT_OPEN',
    );
  await writeStore(file(id), { attempts: [...state.attempts, now] });
}
export async function resetBootGuard(id: string) {
  await writeStore(file(id), { attempts: [] });
}
