import { z } from 'zod';

export const sandboxPolicySchema = z
  .object({
    network: z.enum(['isolated', 'nat']),
    expiresAt: z.iso.datetime(),
    onExpire: z.enum(['stop', 'delete']),
    storage: z.enum(['persistent', 'discard-on-stop']).optional(),
  })
  .strict();

export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;
export const sandboxExpired = (policy: SandboxPolicy, now = Date.now()) =>
  Date.parse(policy.expiresAt) <= now;

export const SANDBOX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const sandboxArtifactSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SandboxArtifact = z.infer<typeof sandboxArtifactSchema>;
export const sandboxExecutionSchema = z.object({
  command: z.string(),
  cwd: z.string(),
  timeoutSeconds: z.number(),
  requestedArtifacts: z.array(z.string()),
  artifacts: z.array(sandboxArtifactSchema),
  exitCode: z.number().int().optional(),
  outcome: z.enum(['success', 'failed', 'timeout', 'cancelled', 'expired', 'interrupted']).optional(),
  timings: z.object({
    bootMs: z.number().optional(),
    commandMs: z.number().optional(),
    artifactsMs: z.number().optional(),
    shutdownMs: z.number().optional(),
    totalMs: z.number().optional(),
  }),
});
export type SandboxExecution = z.infer<typeof sandboxExecutionSchema>;
