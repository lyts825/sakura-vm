import { z } from 'zod';
import * as S from './suite-common.ts';
import * as L from './learning-lab.ts';
import * as T from './suite-execution-learning.ts';
import * as E from './suite-execution.ts';
import { imageAssetSchema } from './image-assets.ts';
import {
  suiteMethod as method,
  suiteControls as controls,
  suiteMaterialMethods,
  suiteExchangeMethods,
  suiteEmpty,
} from './suite-http.ts';
export const learningTemplate = z
  .object({
    id: L.learningTemplateId,
    name: S.suiteName,
    description: z.string().max(1000),
    body: z.string().max(16000),
    files: T.learningSnapshot,
    steps: z.array(L.learningStepDefinition).min(1).max(20),
    rules: z.array(T.learningCheck).min(1).max(30),
  })
  .strict();
export const learningViewInput = z
  .object({
    workspaceId: S.suiteId.optional(),
    cursor: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(20).optional(),
    history: z.boolean().optional(),
  })
  .strict();
export const learningView = z
  .object({
    workspaces: z.array(S.suiteWorkspace).max(50),
    workspace: S.suiteWorkspace.nullable(),
    domains: z
      .array(
        z
          .object({
            id: S.suiteRef.shape.domain,
            records: z.array(S.suiteRecord).max(20),
            next: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export const learningExample = z
  .object({
    workspace: S.suiteWorkspace,
    course: S.suiteRecord,
    source: S.suiteRecord,
    asset: S.suiteRecord,
    lesson: S.suiteRecord,
    steps: S.suiteRecord,
    checks: S.suiteRecord,
    environment: S.suiteRecord,
  })
  .strict();
const { hostCapacity, createWorkspace, listWorkspaces, workspace, revokeWorkspace, capacity, ...materials } =
  suiteMaterialMethods();
export const learningHttpSchemas = {
  courses: {
    ...controls(),
    hostCapacity,
    createWorkspace,
    listWorkspaces,
    workspace,
    revokeWorkspace,
    capacity,
    create: method(
      L.learningCreateCourse,
      z.object({ workspace: S.suiteWorkspace, course: S.suiteRecord }).strict(),
    ),
    sealCourse: method(L.learningSealCourse, S.suiteRecord),
  },
  assets: {
    ...materials,
    images: method(suiteEmpty, z.array(imageAssetSchema).max(1000), true),
    upload: method(L.learningUpload, S.suiteRecord),
    pin: method(L.learningPinAsset, S.suiteRecord),
    files: method(S.suitePin, L.learningFiles, true),
  },
  lessons: { ...controls(), compile: method(L.learningCompileLesson, S.suiteRecord) },
  environments: {
    ...controls(),
    prepare: method(L.learningPrepare, S.suiteRecord),
    checkpoint: method(L.learningCheckpointInput, S.suiteRecord),
    restore: method(L.learningRestore, S.suiteRecord),
  },
  steps: { ...controls(), compile: method(L.learningCompileSteps, S.suiteRecord) },
  checks: {
    ...controls(),
    compile: method(L.learningCompileChecks, S.suiteRecord),
    explain: method(S.suitePin, S.suiteRecord, true),
  },
  sessions: {
    ...controls(),
    tool: method(suiteEmpty, E.suiteExecutionTool, true),
    preview: method(L.learningPreview, S.suitePlan),
    start: method(S.suiteApproval, S.suiteRecord),
    previewStep: method(L.learningStepInput, S.suitePlan),
    step: method(S.suiteApproval, S.suiteRecord),
    discardPreview: method(S.suiteApproval, S.suitePlan),
    inspect: method(L.learningSessionSelection, S.suiteRecord, true),
    cancel: method(L.learningSessionSelection, S.suiteRecord),
    reconcile: method(L.learningSessionSelection, S.suiteRecord),
    pause: method(L.learningSessionSelection, S.suiteRecord),
    resume: method(L.learningSessionSelection, S.suiteRecord),
  },
  progress: {
    ...controls(),
    summarize: method(L.learningProgressInput, S.suiteRecord),
    compare: method(L.learningCompare, S.suiteRecord),
  },
  assessments: {
    ...controls(),
    assess: method(L.learningAssessmentInput, S.suiteRecord),
    selfReview: method(L.learningSelfReview, S.suiteRecord),
    sealAssessment: method(L.learningSealAssessment, S.suiteRecord),
  },
  exchange: suiteExchangeMethods(),
  workbench: {
    ...controls(),
    templates: method(suiteEmpty, z.array(learningTemplate).length(3), true),
    createExample: method(L.learningExampleInput, learningExample),
    view: method(learningViewInput, learningView, true),
  },
} as const;
export const learningHttpRequests = Object.fromEntries(
  Object.entries(learningHttpSchemas).flatMap(([d, methods]) =>
    Object.entries(methods).map(([id, s]) => [`learning-${d}.${id}`, s.request]),
  ),
);
export const learningHttpResponses = Object.fromEntries(
  Object.entries(learningHttpSchemas).flatMap(([d, methods]) =>
    Object.entries(methods).map(([id, s]) => [`learning-${d}.${id}`, s.response]),
  ),
);
