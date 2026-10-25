/** 固定工具会话的持久批准、原资源回执与有界输出。 */
import { z } from 'zod';
import { imageRefSchema, ownedImageVmSchema } from './image-assets.ts';
import { suiteDigest, suiteId, suiteScope } from './suite-common.ts';
export const suiteExecutionProfile = z.enum(['browser', 'database', 'event', 'media', 'learning']);
export type SuiteExecutionProfileId = z.infer<typeof suiteExecutionProfile>;
export const suiteExecutionBudget = z
  .object({
    virtualBytes: z.number().int().positive(),
    imageBytes: z.number().int().positive(),
    memoryMiB: z.number().int().min(256).max(4096),
    cpus: z.number().int().min(1).max(2),
    inputBytes: z
      .number()
      .int()
      .nonnegative()
      .max(8 * 1024 ** 2),
    outputBytes: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 ** 2),
  })
  .strict();
export const suiteExecutionPlan = z
  .object({
    id: suiteId,
    digest: suiteDigest,
    profile: suiteExecutionProfile,
    workspaceId: suiteId,
    actor: suiteId,
    consumer: z.string().min(1).max(200),
    generation: z.string().min(1).max(200),
    image: imageRefSchema,
    inputDigest: suiteDigest,
    toolDigest: suiteDigest,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    maxSeconds: z.number().int().min(1).max(1800),
    budget: suiteExecutionBudget,
    state: z.enum(['ready', 'consumed', 'expired']),
    sessionId: suiteId.nullable(),
  })
  .strict();
export type SuiteExecutionPlan = z.infer<typeof suiteExecutionPlan>;
export const suiteExecutionReceipt = z
  .object({
    id: suiteId,
    planId: suiteId,
    profile: suiteExecutionProfile,
    workspaceId: suiteId,
    actor: suiteId,
    consumer: z.string(),
    generation: z.string(),
    state: z.enum(['preparing', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
    outcome: z.enum(['passed', 'failed', 'inconclusive', 'not-supported']),
    cleanup: z.enum(['pending', 'confirmed', 'unknown']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    deadline: z.iso.datetime(),
    inputDigest: suiteDigest,
    toolDigest: suiteDigest,
    intentDigest: suiteDigest.nullable(),
    vm: ownedImageVmSchema.nullable(),
    identity: z
      .object({
        processId: z.number().int().positive(),
        processCreated: z.string().regex(/^\d{15,22}$/),
        bootId: suiteId.nullable(),
        startedAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
    tools: z.record(z.string().max(80), z.string().max(256)),
    worker: z
      .object({
        pid: z.number().int().positive(),
        startTicks: z.string().regex(/^\d+$/),
        uid: z.literal(65534),
        gid: z.literal(65534),
        exitCode: z.number().int(),
        reason: z.string().max(100),
        elapsedMs: z.number().nonnegative(),
      })
      .strict()
      .nullable()
      .default(null),
    output: z
      .object({
        bytes: z
          .number()
          .int()
          .min(0)
          .max(8 * 1024 ** 2),
        digest: suiteDigest,
      })
      .strict()
      .nullable(),
    error: z.string().max(512).nullable(),
  })
  .strict();
export type SuiteExecutionReceipt = z.infer<typeof suiteExecutionReceipt>;
export const suiteExecutionPin = suiteScope.extend({ id: suiteId }).strict();
export const suiteExecutionApproval = suiteScope.extend({ planId: suiteId, digest: suiteDigest }).strict();
export const suiteExecutionPreview = suiteScope
  .extend({
    image: imageRefSchema,
    input: z.json(),
    inputDigest: suiteDigest,
    maxSeconds: z.number().int().min(1).max(1800),
  })
  .strict();
export const suiteExecutionOutputInput = suiteExecutionPin
  .extend({
    offset: z.number().int().min(0),
    length: z
      .number()
      .int()
      .min(1)
      .max(512 * 1024),
  })
  .strict();
export const suiteExecutionOutput = z
  .object({
    data: z.string().max(700000),
    offset: z.number().int().min(0),
    eof: z.boolean(),
    digest: suiteDigest,
    total: z
      .number()
      .int()
      .min(0)
      .max(8 * 1024 ** 2),
  })
  .strict();
export const suiteExecutionChallenge = z
  .object({
    sessionId: suiteId,
    planId: suiteId,
    digest: suiteDigest,
    inputDigest: suiteDigest,
    budget: suiteExecutionBudget,
  })
  .strict();
export type SuiteExecutionChallenge = z.infer<typeof suiteExecutionChallenge>;
export const suiteExecutionTool = z
  .object({
    id: suiteExecutionProfile,
    digest: suiteDigest,
    available: z.boolean(),
    platform: z.string(),
    maximumSeconds: z.number().int().positive(),
    maximumInputBytes: z.number().int().positive(),
    maximumOutputBytes: z.number().int().positive(),
    gaps: z.array(z.string().max(500)).max(20),
  })
  .strict();
