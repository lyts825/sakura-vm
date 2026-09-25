import { z } from 'zod';

export const sandboxPolicySchema = z
  .object({
    network: z.enum(['isolated', 'nat']),
    expiresAt: z.iso.datetime(),
    onExpire: z.enum(['stop', 'delete']),
  })
  .strict();

export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;
export const sandboxExpired = (policy: SandboxPolicy, now = Date.now()) =>
  Date.parse(policy.expiresAt) <= now;
