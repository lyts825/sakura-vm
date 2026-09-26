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
