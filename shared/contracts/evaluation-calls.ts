/** 固定本机文本协议；没有任意 URL 路径或工具调用。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
export const evaluationUrl = z
  .string()
  .max(200)
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        u.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) &&
        !!u.port &&
        !u.username &&
        !u.password &&
        u.pathname === '/' &&
        !u.search &&
        !u.hash
      );
    } catch {
      return false;
    }
  }, '需要显式端口的本机 HTTP 模型根地址');
export const evaluationModel = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
export const evaluationTarget = z
  .object({
    url: evaluationUrl,
    model: evaluationModel,
    protocol: z.literal('ollama-local-v1'),
    secretVersion: S.suiteDigest.nullable(),
  })
  .strict();
export const evaluationOptions = z
  .object({
    temperature: z.number().min(0).max(2).default(0),
    maxTokens: z.number().int().min(1).max(4096).default(512),
    seed: z.number().int().min(0).max(2147483647).default(0),
  })
  .strict();
export const evaluationConnection = z
  .object({
    modelDigest: S.suiteDigest,
    protocolVersion: z.string().max(128).nullable(),
    localWeights: z.literal(true),
    checkedAt: z.iso.datetime(),
  })
  .strict();
export const evaluationCallInput = z
  .object({
    id: S.suiteId,
    planDigest: S.suiteDigest,
    target: evaluationTarget,
    modelDigest: S.suiteDigest,
    system: z.string().max(8192),
    prompt: z.string().max(65536),
    options: evaluationOptions,
    maxOutputBytes: z.number().int().min(1).max(65536).optional(),
    deadline: z.iso.datetime(),
  })
  .strict();
export const evaluationCallReceipt = z
  .object({
    id: S.suiteId,
    actor: S.suiteId,
    consumer: z.string(),
    generation: z.string(),
    requestDigest: S.suiteDigest,
    planDigest: S.suiteDigest,
    modelDigest: S.suiteDigest,
    state: z.enum(['intent', 'sent', 'returned', 'rejected', 'unknown']),
    createdAt: z.iso.datetime(),
    sentAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    output: z.string().max(65536).nullable(),
    outputDigest: S.suiteDigest.nullable(),
    elapsedMs: z.number().int().min(0).nullable(),
    usage: z
      .object({ input: z.number().int().min(0).nullable(), output: z.number().int().min(0).nullable() })
      .strict(),
    truncated: z.boolean(),
    error: z.string().max(120).nullable(),
    intentDigest: S.suiteDigest.nullable(),
  })
  .strict();
export type EvaluationTarget = z.infer<typeof evaluationTarget>;
export type EvaluationConnection = z.infer<typeof evaluationConnection>;
export type EvaluationCallInput = z.infer<typeof evaluationCallInput>;
export type EvaluationCallReceipt = z.infer<typeof evaluationCallReceipt>;
export type EvaluationAuthorization = { bearer: string | null };
