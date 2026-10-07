/**
 * 模块职责：记录短时间内的启动失败并熔断重复启动，支持检查后的显式复位。
 * Module purpose: Tracks recent startup failures and opens a circuit against repeated failures, with explicit reset after inspection.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import { metadataFile } from './metadata-store.ts';

const WINDOW = 300000,
  LIMIT = 5;
const schema = z.object({ attempts: z.array(z.number().int().nonnegative()).max(100) }).strict();
/**
 * 入口 / Entry: file.
 * 功能：在记录短时间内的启动失败并熔断重复启动中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(id), 'boot-guard.json')` 供上层消费（`boot-guard.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `boot-guard.ts`; this entry produces `join(vmDir(id), 'boot-guard.json')` for its caller. Module context: Tracks recent startup failures and opens a circuit against repeated failures, with explicit reset after inspection.
 * 处理：通过 `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `vmDir`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `join(vmDir(id), 'boot-guard.json')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const file = (id: string) => join(vmDir(id), 'boot-guard.json');
/**
 * 入口 / Entry: store.
 * 功能：在记录短时间内的启动失败并熔断重复启动中，执行此领域的具体处理步骤并返回其结果；本入口产生 `metadataFile(file(id), () => ({ attempts: [] as number[] }), schema.parse)` 供上层消费（`boot-guard.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `boot-guard.ts`; this entry produces `metadataFile(file(id), () => ({ attempts: [] as number[] }), schema.parse)` for its caller. Module context: Tracks recent startup failures and opens a circuit against repeated failures, with explicit reset after inspection.
 * 处理：通过 `metadataFile`, `file` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `metadataFile`, `file`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `metadataFile(file(id), () => ({ attempts: [] as number[] }), schema.parse)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const store = (id: string) => metadataFile(file(id), () => ({ attempts: [] as number[] }), schema.parse);
/**
 * 入口 / Entry: status.
 * 功能：从当前输入或状态计算 `{ attempts, failures: attempts.length, limit: LIMIT, windowSeconds: WINDOW / 1000, blocked: attempts.length >= LIMIT, retryAt…`，供调用方后续验证或使用。
 * Purpose: Computes `{ attempts, failures: attempts.length, limit: LIMIT, windowSeconds: WINDOW / 1000, blocked: attempts.length >= LIMIT, retryAt…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: saved: { attempts: number[] }; now: number
 * 输出 / Returns: `{ attempts, failures: attempts.length, limit: LIMIT, windowSeconds: WINDOW / 1000, blocked: attempts.length >= LIMIT, retryAt…`.
 * 副作用 / Effects: `saved.attempts.filter`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: bootGuardStatus.
 * 功能：在记录短时间内的启动失败并熔断重复启动中，执行此领域的具体处理步骤并返回其结果；本入口产生 `status((await store(id).read()).value, now)` 供上层消费（`boot-guard.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `boot-guard.ts`; this entry produces `status((await store(id).read()).value, now)` for its caller. Module context: Tracks recent startup failures and opens a circuit against repeated failures, with explicit reset after inspection.
 * 处理：通过 `status`, `store().read`, `store` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `status`, `store().read`, `store`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; now: default=Date.now()
 * 输出 / Returns: `status((await store(id).read()).value, now)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function bootGuardStatus(id: string, now = Date.now()) {
  return status((await store(id).read()).value, now);
}
/**
 * 入口 / Entry: recordBootAttempt.
 * 功能：在记录短时间内的启动失败并熔断重复启动中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`boot-guard.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `boot-guard.ts`; the calls and state transitions below complete the operation. Module context: Tracks recent startup failures and opens a circuit against repeated failures, with explicit reset after inspection.
 * 处理：通过 `store().update`, `store` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `store().update`, `store`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; now: default=Date.now()
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `store().update`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: resetBootGuard.
 * 功能：在记录短时间内的启动失败并熔断重复启动中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`boot-guard.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `boot-guard.ts`; the calls and state transitions below complete the operation. Module context: Tracks recent startup failures and opens a circuit against repeated failures, with explicit reset after inspection.
 * 处理：通过 `store().replace`, `store` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `store().replace`, `store`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `store().replace`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function resetBootGuard(id: string) {
  await store(id).replace({ attempts: [] });
}
