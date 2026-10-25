import { z } from 'zod';
import * as S from './suite-common.ts';
import * as M from './media-studio.ts';
import {
  suiteMethod as m,
  suiteControls,
  suiteMaterialMethods,
  suiteExchangeMethods,
  suiteEmpty,
} from './suite-http.ts';
const jobMethods = () => ({
  ...suiteControls(),
  poll: m(M.mediaAction, S.suiteRecord),
  cancel: m(M.mediaAction, S.suiteRecord),
  reconcile: m(M.mediaAction, S.suitePlan),
  confirmReconcile: m(S.suiteApproval, S.suiteRecord),
  discardPreview: m(S.suiteApproval, S.suitePlan),
});
export const mediaHttpSchemas = {
  sources: { ...suiteMaterialMethods(), pin: m(M.mediaPin, S.suiteRecord) },
  inspect: {
    ...jobMethods(),
    preview: m(M.mediaInspectPreview, S.suitePlan),
    inspect: m(S.suiteApproval, S.suiteRecord),
  },
  recipes: {
    ...suiteControls(),
    validate: m(M.mediaCompile, z.object({ valid: z.literal(true), recipe: M.mediaRecipe }).strict(), true),
    compile: m(M.mediaCompile, S.suiteRecord),
  },
  workers: {
    ...jobMethods(),
    preview: m(M.mediaRunPreview, S.suitePlan),
    start: m(S.suiteApproval, S.suiteRecord),
    publish: m(M.mediaAction, S.suiteRecord),
  },
  captions: {
    ...suiteControls(),
    importText: m(M.mediaCaptionInput, S.suiteRecord),
    validateTiming: m(
      M.mediaCaptionInput,
      z.object({ valid: z.literal(true), cues: z.array(M.mediaCue).min(1).max(200) }).strict(),
      true,
    ),
    exportText: m(M.mediaSelect('caption'), S.suiteRecord),
  },
  collections: {
    ...suiteControls(),
    assemble: m(M.mediaAssemble, S.suiteRecord),
    compare: m(M.mediaCompare, S.suiteRecord),
  },
  reviews: {
    ...suiteControls(),
    open: m(M.mediaSelect('collection'), S.suiteRecord),
    decide: m(M.mediaDecision, S.suiteRecord),
    recheck: m(M.mediaSelect('review'), S.suiteRecord, true),
  },
  exchange: { ...suiteExchangeMethods() },
  workbench: {
    ...suiteControls(),
    templates: m(suiteEmpty, M.mediaTemplates, true),
    view: m(S.suiteScope, M.mediaView, true),
  },
} as const;
export const mediaHttpRequests = Object.fromEntries(
  Object.entries(mediaHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([name, schema]) => [`media-${domain}.${name}`, schema.request]),
  ),
);
export const mediaHttpResponses = Object.fromEntries(
  Object.entries(mediaHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([name, schema]) => [`media-${domain}.${name}`, schema.response]),
  ),
);
