/**
 * 模块职责（中文）：虚拟机沙箱策略、执行和制品契约，约束资源、时限、输出大小及到期判定。
 * Module responsibility (English): Defining sandbox policy, execution, artifact limits and expiry state.
 * 详细范围（中文）：公开入口包括 sandboxPolicySchema, SandboxPolicy, sandboxExpired, SANDBOX_ARTIFACT_BYTES, sandboxArtifactSchema, SandboxArtifact, sandboxExecutionSchema, SandboxExecution；职责覆盖定义沙箱策略、执行、制品限制和到期状态，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include sandboxPolicySchema, SandboxPolicy, sandboxExpired, SANDBOX_ARTIFACT_BYTES, sandboxArtifactSchema, SandboxArtifact, sandboxExecutionSchema, SandboxExecution. The scope covers Defining sandbox policy, execution, artifact limits and expiry state. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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
/**
 * 中文：比较沙箱到期时间与给定时钟，未设置有效到期值时不把沙箱当作已过期。
 * English: Compare sandbox expiry with the supplied clock, avoiding expired classification when no valid expiry is set.
 * 中文：输入：policy：签名所示 SandboxPolicy 业务值；now：此处理器的调用值（缺省 Date.now()）
 * English: Inputs: policy: the SandboxPolicy domain value in the signature; now: the invocation value for this handler (default Date.now())
 */
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
