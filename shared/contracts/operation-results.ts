import { z } from 'zod';

export const operationResultSchema = z
  .object({
    correlationId: z.uuid(),
    operationId: z.string().min(1).max(200),
    outcome: z.enum(['pending', 'succeeded', 'failed', 'unknown']),
    executed: z.boolean(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().optional(),
    responseStatus: z.number().int().min(100).max(599).optional(),
    responseValidated: z.boolean(),
    auditRecorded: z.boolean(),
    delivery: z.enum(['pending', 'sent', 'failed', 'unknown']),
    errorCode: z.string().max(80).optional(),
  })
  .strict();
export type OperationResult = z.infer<typeof operationResultSchema>;
