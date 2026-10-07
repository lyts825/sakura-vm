/**
 * 模块职责：定义私密配置轮换策略并计算提醒状态，确保提醒提前量小于轮换周期。
 * Module purpose: Declares secret rotation/reminder policies, ensuring advance notice is shorter than the rotation interval.
 */
import { z } from 'zod';

export const rotationPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    maxAgeDays: z.number().int().min(1).max(3650).default(90),
    remindBeforeDays: z.number().int().min(0).max(365).default(14),
  })
  .strict()
  .refine((value) => value.remindBeforeDays < value.maxAgeDays, '提前提醒天数必须小于轮换周期');
export type RotationPolicy = z.infer<typeof rotationPolicySchema>;
export type SecretRotationItem = {
  name: string;
  lastChangedAt: string;
  policy: RotationPolicy;
  ageDays: number | null;
  dueAt: string | null;
  daysRemaining: number | null;
  status: 'disabled' | 'unknown' | 'current' | 'due-soon' | 'overdue';
};
/**
 * 入口 / Entry: secretRotation.
 * 功能：从当前输入或状态计算 `{ name, lastChangedAt, policy, ageDays: valid ? Math.floor((now - changed) / day) : null, dueAt: due === null ? null : new Da…`，供调用方后续验证或使用。
 * Purpose: Computes `{ name, lastChangedAt, policy, ageDays: valid ? Math.floor((now - changed) / day) : null, dueAt: due === null ? null : new Da…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: name: string; lastChangedAt: string; input: unknown; now: default=Date.now()
 * 输出 / Returns: SecretRotationItem；结果来自 / values from `{ name, lastChangedAt, policy, ageDays: valid ? Math.floor((now - changed) / day) : null, dueAt: due === null ? null : new Da…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function secretRotation(
  name: string,
  lastChangedAt: string,
  input: unknown,
  now = Date.now(),
): SecretRotationItem {
  const policy = rotationPolicySchema.parse(input || {}),
    changed = Date.parse(lastChangedAt),
    day = 86400000;
  const valid = Number.isFinite(changed) && changed <= now;
  const due = valid ? changed + policy.maxAgeDays * day : null;
  return {
    name,
    lastChangedAt,
    policy,
    ageDays: valid ? Math.floor((now - changed) / day) : null,
    dueAt: due === null ? null : new Date(due).toISOString(),
    daysRemaining: due === null ? null : Math.ceil((due - now) / day),
    status: !policy.enabled
      ? 'disabled'
      : due === null
        ? 'unknown'
        : now >= due
          ? 'overdue'
          : now >= due - policy.remindBeforeDays * day
            ? 'due-soon'
            : 'current',
  };
}
