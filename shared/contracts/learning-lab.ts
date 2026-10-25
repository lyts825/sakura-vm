/** 所有者自学课程、固定动作和实际课内检查；没有考试或认证权限。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as T from './suite-execution-learning.ts';
import { imageRefSchema } from './image-assets.ts';
const text = z.string().max(16000),
  key = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const learningCreateCourse = z
  .object({ workspaceId: S.suiteId.optional(), name: S.suiteName, title: S.suiteName, description: text })
  .strict();
export const learningCourse = z
  .object({
    format: z.literal('sakura-learning-course/1'),
    title: S.suiteName,
    description: text,
    status: z.enum(['draft', 'ready']),
    lessons: z.array(S.suiteRef).max(12),
    selfStudyOnly: z.literal(true),
  })
  .strict();
export const learningCourseSelection = S.suiteScope.extend({ course: S.suiteRef }).strict();
export const learningSealCourse = learningCourseSelection
  .extend({ lessons: z.array(S.suiteRef).min(1).max(12) })
  .strict();
export const learningFiles = z
  .object({ format: z.literal('sakura-learning-files/1'), files: T.learningSnapshot })
  .strict();
export const learningUpload = S.suiteScope
  .extend({ name: S.suiteName, files: T.learningSnapshot, allowExport: z.boolean().default(false) })
  .strict();
export const learningPinAsset = S.suiteScope
  .extend({ name: S.suiteName, source: S.suiteRef, image: imageRefSchema })
  .strict();
export const learningAsset = z
  .object({
    format: z.literal('sakura-learning-asset/1'),
    source: S.suiteRef,
    sourceDigest: S.suiteDigest,
    image: imageRefSchema,
    paths: z.array(T.learningPath).max(100),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(2 * 1024 ** 2),
  })
  .strict();
export const learningCompileLesson = S.suiteScope
  .extend({
    name: S.suiteName,
    course: S.suiteRef,
    asset: S.suiteRef,
    key,
    title: S.suiteName,
    body: text,
    prerequisites: z.array(key).max(12),
  })
  .strict();
export const learningLesson = z
  .object({
    format: z.literal('sakura-learning-lesson/1'),
    course: S.suiteRef,
    asset: S.suiteRef,
    key,
    title: S.suiteName,
    body: text,
    prerequisites: z.array(key).max(12),
  })
  .strict();
export const learningStepDefinition = z
  .object({
    id: key,
    title: S.suiteName,
    instruction: text,
    action: T.learningAction,
    editableContent: z.boolean().default(false),
    editableBody: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.editableContent && value.action.kind !== 'write') ||
      (value.editableBody && value.action.kind !== 'request')
    )
      context.addIssue({ code: 'custom', message: '可编辑字段与固定动作不匹配' });
  });
export const learningCompileSteps = S.suiteScope
  .extend({ name: S.suiteName, lesson: S.suiteRef, steps: z.array(learningStepDefinition).min(1).max(20) })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.steps.map((s) => s.id)).size !== value.steps.length)
      context.addIssue({ code: 'custom', message: '步骤 ID 重复' });
  });
export const learningSteps = z
  .object({
    format: z.literal('sakura-learning-steps/1'),
    lesson: S.suiteRef,
    steps: z.array(learningStepDefinition).min(1).max(20),
  })
  .strict();
export const learningCompileChecks = S.suiteScope
  .extend({ name: S.suiteName, lesson: S.suiteRef, rules: z.array(T.learningCheck).min(1).max(30) })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.rules.map((r) => r.id)).size !== value.rules.length)
      context.addIssue({ code: 'custom', message: '检查 ID 重复' });
  });
export const learningChecks = z
  .object({
    format: z.literal('sakura-learning-checks/1'),
    lesson: S.suiteRef,
    rules: z.array(T.learningCheck).min(1).max(30),
    coverage: z.literal('fixed-local-tool-checks'),
  })
  .strict();
export const learningPrepare = S.suiteScope
  .extend({ name: S.suiteName, course: S.suiteRef, asset: S.suiteRef })
  .strict();
export const learningEnvironment = z
  .object({
    format: z.literal('sakura-learning-environment/1'),
    course: S.suiteRef,
    asset: S.suiteRef,
    image: imageRefSchema,
    snapshot: T.learningSnapshot,
    snapshotDigest: S.suiteDigest,
    demo: T.learningDemo,
    fromCheckpoint: S.suiteRef.nullable(),
    preparation: z.literal('fixed-input-definition'),
    executionStarted: z.literal(false),
  })
  .strict();
export const learningSessionSelection = S.suiteScope.extend({ session: S.suiteRef }).strict();
export const learningCheckpointInput = learningSessionSelection.extend({ name: S.suiteName }).strict();
export const learningCheckpoint = z
  .object({
    format: z.literal('sakura-learning-checkpoint/1'),
    session: S.suiteRef,
    course: S.suiteRef,
    asset: S.suiteRef,
    image: imageRefSchema,
    snapshot: T.learningSnapshot,
    snapshotDigest: S.suiteDigest,
    demo: T.learningDemo,
    originalAttempt: S.suiteId,
    progressTransferred: z.literal(false),
  })
  .strict();
export const learningRestore = S.suiteScope.extend({ checkpoint: S.suiteRef, name: S.suiteName }).strict();
export const learningPreview = S.suiteScope
  .extend({
    name: S.suiteName,
    course: S.suiteRef,
    environment: S.suiteRef,
    steps: z.array(S.suiteRef).min(1).max(12),
    checks: z.array(S.suiteRef).min(1).max(12),
  })
  .strict();
export const learningStepInput = learningSessionSelection
  .extend({
    lesson: S.suiteRef,
    stepId: key,
    content: T.learningFile.shape.content.optional(),
    body: S.suiteJson.optional(),
  })
  .strict();
const attempt = z
  .object({
    sequence: z.number().int().min(0).max(30),
    lesson: S.suiteRef.nullable(),
    stepId: key.nullable(),
    coreId: S.suiteId,
    planDigest: S.suiteDigest,
    inputDigest: S.suiteDigest,
    state: z.enum(['preparing', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
    cleanup: z.enum(['pending', 'confirmed', 'unknown']),
    outcome: z.enum(['passed', 'failed', 'inconclusive', 'not-supported']),
    result: T.learningWorkerOutput.nullable(),
    error: z.string().max(1000).nullable(),
  })
  .strict();
export const learningSession = z
  .object({
    format: z.literal('sakura-learning-session/1'),
    course: S.suiteRef,
    environment: S.suiteRef,
    steps: z.array(S.suiteRef).max(12),
    checks: z.array(S.suiteRef).max(12),
    status: z.enum(['active', 'paused', 'finished', 'interrupted', 'cancelled']),
    snapshot: T.learningSnapshot,
    snapshotDigest: S.suiteDigest,
    demo: T.learningDemo,
    attempts: z.array(attempt).max(31),
    completedLessons: z.array(S.suiteRef).max(12),
    performed: z.array(z.object({ lesson: S.suiteRef, stepId: key }).strict()).max(30),
    pending: S.suiteId.nullable(),
    startedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    idleExpiresAt: z.iso.datetime(),
    deadline: z.iso.datetime(),
    cleanup: z.enum(['pending', 'confirmed', 'unknown']),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    selfStudyOnly: z.literal(true),
  })
  .strict();
export const learningProgressInput = learningCourseSelection;
export const learningProgress = z
  .object({
    format: z.literal('sakura-learning-progress/1'),
    course: S.suiteRef,
    actor: S.suiteId,
    attempts: z
      .array(
        z
          .object({
            session: S.suiteRef,
            status: learningSession.shape.status,
            completed: z.number().int().nonnegative().max(12),
            total: z.number().int().min(1).max(12),
            outcome: learningSession.shape.outcome,
          })
          .strict(),
      )
      .max(100),
    certification: z.literal(false),
  })
  .strict();
export const learningCompare = S.suiteScope.extend({ left: S.suiteRef, right: S.suiteRef }).strict();
export const learningAssessmentInput = learningSessionSelection.extend({ name: S.suiteName }).strict();
export const learningAssessment = z
  .object({
    format: z.literal('sakura-learning-assessment/1'),
    session: S.suiteRef,
    course: S.suiteRef,
    completed: z.number().int().min(0).max(12),
    total: z.number().int().min(1).max(12),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    cleanup: learningSession.shape.cleanup,
    selfReview: z.object({ actor: S.suiteId, note: text, completed: z.boolean() }).strict().nullable(),
    status: z.enum(['review', 'sealed']),
    certification: z.literal(false),
    basis: z.literal('actual-local-tool-checks'),
  })
  .strict();
export const learningSelfReview = S.suiteScope
  .extend({ assessment: S.suiteRef, note: z.string().min(1).max(16000), completed: z.boolean() })
  .strict();
export const learningSealAssessment = S.suiteScope.extend({ assessment: S.suiteRef }).strict();
export const learningTemplateId = z.enum([
  'files-and-directories',
  'configuration-repair',
  'request-response',
]);
export const learningExampleInput = z
  .object({ name: S.suiteName, template: learningTemplateId, image: imageRefSchema })
  .strict();
export type LearningSession = z.infer<typeof learningSession>;
