/** 固定本地队列实验：声明输入不包含 SQL、脚本、URL 或命令。 */
import { z } from 'zod';
import { suiteDigest, suiteJson } from './suite-common.ts';
export function eventExecutionBudget(input: {
  experiment: string;
  messages: { id: string }[];
  poisonIds: string[];
  retryLimit: number;
  idempotent: boolean;
}) {
  let deliveries = 0,
    trace = 0;
  const copies = input.experiment === 'duplicate-delivery' ? 2 : 1,
    poison = new Set(input.poisonIds);
  for (const message of input.messages) {
    trace += 1 + copies;
    if (poison.has(message.id)) {
      deliveries += copies * (input.retryLimit + 1);
      trace += copies * (2 * (input.retryLimit + 1) + 1);
    } else if (input.experiment === 'ack-loss') {
      deliveries += input.retryLimit ? 2 : 1;
      trace += 4 + (input.retryLimit ? (input.idempotent ? 3 : 4) : 1);
    } else {
      deliveries += copies;
      trace += copies * 4 - (copies === 2 && input.idempotent ? 1 : 0);
    }
  }
  return { deliveries, trace };
}
export const eventWorkerInput = z
  .object({
    protocol: z.literal('sakura-event-tool/1'),
    experiment: z.enum(['duplicate-delivery', 'ack-loss', 'slow-consumer']),
    messages: z
      .array(
        z
          .object({ id: z.string().min(1).max(100), key: z.string().min(1).max(100), payload: suiteJson })
          .strict(),
      )
      .min(1)
      .max(1000),
    ordering: z.enum(['fifo', 'per-key']),
    idempotent: z.boolean(),
    delayMs: z.number().int().min(0).max(500),
    retryLimit: z.number().int().min(0).max(3),
    poisonIds: z.array(z.string().min(1).max(100)).max(1000).default([]),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (new Set(input.messages.map((m) => m.id)).size !== input.messages.length)
      ctx.addIssue({ code: 'custom', message: '消息 ID 不可重复' });
    if (input.poisonIds.some((id) => !input.messages.some((m) => m.id === id)))
      ctx.addIssue({ code: 'custom', message: '拒绝策略只能引用原消息' });
    if (eventExecutionBudget(input).trace > 12000)
      ctx.addIssue({ code: 'custom', message: '声明的完整轨迹超过12000条，请减少消息或重试次数' });
  });
export type EventWorkerInput = z.infer<typeof eventWorkerInput>;
export const eventWorkerOutput = z
  .object({
    protocol: z.literal('sakura-event-result/1'),
    sessionId: z.uuid(),
    inputDigest: suiteDigest,
    broker: z
      .object({
        engine: z.literal('sqlite-wal'),
        version: z.string(),
        pid: z.number().int().positive(),
        startTicks: z.string(),
      })
      .strict(),
    consumer: z.object({ pid: z.number().int().positive(), startTicks: z.string() }).strict(),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    produced: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    acknowledged: z.number().int().nonnegative(),
    deduplicated: z.number().int().nonnegative(),
    deadLetters: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    effects: z
      .array(
        z
          .object({
            messageId: z.string(),
            key: z.string(),
            count: z.number().int().positive(),
            digest: suiteDigest,
          })
          .strict(),
      )
      .max(1000),
    trace: z
      .array(
        z
          .object({
            sequence: z.number().int().positive(),
            kind: z.enum([
              'produce',
              'enqueue',
              'deliver',
              'effect',
              'effect-applied',
              'deduplicate',
              'ack',
              'ack-lost',
              'reject',
              'dead-letter',
            ]),
            messageId: z.string(),
            deliveryId: z.string().nullable(),
            attempt: z.number().int().nonnegative(),
            atNs: z.string(),
          })
          .strict(),
      )
      .max(12000),
    elapsedMs: z.number().nonnegative(),
  })
  .strict();
