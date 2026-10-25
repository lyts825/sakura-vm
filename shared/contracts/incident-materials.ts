/** 人工观察与派生材料审阅输入。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import { incidentTime } from './incident-desk.ts';
export const incidentObservationInput = S.suiteScope
  .extend({
    name: S.suiteName,
    text: z
      .string()
      .min(1)
      .max(1024 ** 2),
    observedAt: incidentTime.nullable().default(null),
  })
  .strict();
export const incidentRedactionReviewInput = S.suiteScope
  .extend({
    evidence: S.suiteRef,
    decision: z.enum(['approve', 'reject']),
    reason: z.string().min(1).max(4000),
  })
  .strict();
