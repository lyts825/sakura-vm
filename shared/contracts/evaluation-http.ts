/** 每项操作独立验证，不开放内部凭据解析或任意调用。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as E from './evaluation-studio.ts';
import {
  suiteMethod as method,
  suiteControls as controls,
  suiteMaterialMethods,
  suiteExchangeMethods,
  suiteEmpty,
} from './suite-http.ts';
export const evaluationUpload = S.suiteScope
  .extend({ name: S.suiteName, text: z.string().max(1024 * 1024), allowExport: z.boolean().default(false) })
  .strict();
export const evaluationRender = E.evaluationSelect('prompt')
  .extend({ cursor: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(10) })
  .strict();
export const evaluationHttpSchemas = {
  datasets: {
    ...suiteMaterialMethods(),
    upload: method(evaluationUpload, S.suiteRecord),
    pin: method(E.evaluationPin, S.suiteRecord),
    split: method(E.evaluationSplit, S.suiteRecord),
    allowSending: method(E.evaluationSending, S.suiteRecord),
  },
  prompts: {
    ...controls(),
    compile: method(E.evaluationCompile, S.suiteRecord),
    renderPreview: method(
      evaluationRender,
      z
        .object({
          total: z.number().int(),
          items: z
            .array(z.object({ sampleId: z.string(), prompt: z.string(), digest: S.suiteDigest }).strict())
            .max(20),
          next: z.number().int().nullable(),
        })
        .strict(),
      true,
    ),
  },
  endpoints: {
    ...controls(),
    register: method(E.evaluationRegister, S.suiteRecord),
    previewConnection: method(E.evaluationSelect('endpoint'), S.suitePlan),
    check: method(S.suiteApproval, S.suiteRecord),
    revoke: method(E.evaluationSelect('endpoint'), S.suiteRecord),
  },
  runners: {
    ...controls(),
    importOutputs: method(E.evaluationImportOutputs, S.suiteRecord),
    preview: method(E.evaluationPreview, S.suitePlan),
    start: method(S.suiteApproval, S.suiteRecord),
    inspect: method(E.evaluationRunKey, S.suiteRecord, true),
    cancel: method(E.evaluationRunKey, S.suiteRecord),
    reconcile: method(E.evaluationRunKey, S.suiteRecord),
  },
  scorers: {
    ...controls(),
    evaluate: method(E.evaluationEvaluate, S.suiteRecord),
    scoreHuman: method(E.evaluationHuman, S.suiteRecord),
    planJudge: method(E.evaluationJudge, S.suitePlan),
    applyJudge: method(S.suiteApproval, S.suiteRecord),
    cancelJudge: method(E.evaluationRunKey, S.suiteRecord),
  },
  comparisons: {
    ...controls(),
    compare: method(E.evaluationCompare, S.suiteRecord),
    explain: method(E.evaluationSelect('comparison'), S.suiteRecord, true),
  },
  reviews: {
    ...controls(),
    open: method(E.evaluationReviewOpen, S.suiteRecord),
    score: method(E.evaluationReviewDecide, S.suiteRecord),
    decide: method(E.evaluationReviewDecide, S.suiteRecord),
  },
  reports: {
    ...controls(),
    sealReport: method(E.evaluationReportSeal, S.suiteRecord),
    compare: method(S.suiteScope.extend({ before: S.suiteRef, after: S.suiteRef }).strict(), S.suiteRecord),
  },
  exchange: suiteExchangeMethods(),
  workbench: {
    ...controls(),
    view: method(E.evaluationWorkbenchRequest, E.evaluationWorkbenchView, true),
    templates: method(suiteEmpty, z.array(E.evaluationTemplate).max(10), true),
  },
} as const;
export type EvaluationDomain = keyof typeof evaluationHttpSchemas;
export const evaluationHttpRequests = Object.fromEntries(
  Object.entries(evaluationHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([id, schema]) => [`evaluation-${domain}.${id}`, schema.request]),
  ),
);
export const evaluationHttpResponses = Object.fromEntries(
  Object.entries(evaluationHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([id, schema]) => [`evaluation-${domain}.${id}`, schema.response]),
  ),
);
