/** 固定课内文件与演示服务协议；没有脚本、命令、任意 URL 或宿主路径。 */
import { z } from 'zod';
import { suiteDigest, suiteJson } from './suite-common.ts';
const utf8 = (value: string) => new TextEncoder().encode(value).length;
export const learningPath = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/)
  .refine(
    (value) =>
      value.split('/').every((part) => part !== '.' && part !== '..') && value.split('/').length <= 8,
    '课内相对路径无效',
  );
const content = z.string().refine((value) => utf8(value) <= 64 * 1024, '单文件最大64KiB');
export const learningFile = z.object({ path: learningPath, content }).strict();
export const learningSnapshot = z
  .array(learningFile)
  .max(100)
  .superRefine((files, ctx) => {
    if (new Set(files.map((file) => file.path)).size !== files.length)
      ctx.addIssue({ code: 'custom', message: '快照路径重复' });
    if (files.reduce((sum, file) => sum + utf8(file.content), 0) > 2 * 1024 ** 2)
      ctx.addIssue({ code: 'custom', message: '快照最大2MiB' });
    if (files.some((file) => files.some((other) => other.path.startsWith(file.path + '/'))))
      ctx.addIssue({ code: 'custom', message: '文件与目录路径冲突' });
  });
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const learningCheck = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('exists'), path: learningPath, expected: z.boolean() }).strict(),
  z
    .object({
      id,
      kind: z.literal('text'),
      path: learningPath,
      expected: content,
      mode: z.enum(['equals', 'contains']),
    })
    .strict(),
  z.object({ id, kind: z.literal('json'), path: learningPath, expected: suiteJson }).strict(),
  z.object({ id, kind: z.literal('status'), expected: z.union([z.literal(200), z.literal(503)]) }).strict(),
]);
export const learningAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list') }).strict(),
  z.object({ kind: z.literal('read'), path: learningPath }).strict(),
  z.object({ kind: z.literal('write'), path: learningPath, content }).strict(),
  z.object({ kind: z.literal('demo-start') }).strict(),
  z.object({ kind: z.literal('demo-stop') }).strict(),
  z
    .object({
      kind: z.literal('request'),
      method: z.enum(['GET', 'POST']),
      path: z.enum(['/state', '/echo']),
      body: suiteJson.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('check') }).strict(),
]);
export const learningDemo = z.object({ running: z.boolean(), data: suiteJson }).strict();
export const learningWorkerInput = z
  .object({
    protocol: z.literal('sakura-learning-tool/1'),
    snapshot: learningSnapshot,
    action: learningAction,
    checks: z.array(learningCheck).max(30),
    demo: learningDemo,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.checks.map((check) => check.id)).size !== value.checks.length)
      ctx.addIssue({ code: 'custom', message: '检查ID重复' });
    if (utf8(JSON.stringify(value.demo.data)) > 64 * 1024)
      ctx.addIssue({ code: 'custom', message: '演示状态最大64KiB' });
    if (
      value.action.kind === 'request' &&
      value.action.body !== undefined &&
      utf8(JSON.stringify(value.action.body)) > 64 * 1024
    )
      ctx.addIssue({ code: 'custom', message: '请求最大64KiB' });
  });
export const learningWorkerOutput = z
  .object({
    protocol: z.literal('sakura-learning-result/1'),
    sessionId: z.uuid(),
    inputDigest: suiteDigest,
    completed: z.boolean(),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    snapshot: z
      .array(
        learningFile
          .extend({
            digest: suiteDigest,
            bytes: z
              .number()
              .int()
              .min(0)
              .max(64 * 1024),
          })
          .strict(),
      )
      .max(100),
    snapshotDigest: suiteDigest,
    observation: suiteJson,
    checks: z
      .array(
        z
          .object({
            id,
            kind: z.enum(['exists', 'text', 'json', 'status']),
            passed: z.boolean(),
            actual: suiteJson,
            error: z.string().max(200).nullable(),
          })
          .strict(),
      )
      .max(30),
    demo: learningDemo,
    error: z
      .object({ code: z.string().max(100), message: z.string().max(200) })
      .strict()
      .nullable(),
  })
  .strict();
export type LearningWorkerInput = z.infer<typeof learningWorkerInput>;
export type LearningWorkerOutput = z.infer<typeof learningWorkerOutput>;
