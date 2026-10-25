/** 媒体制作只接受固定操作和有界字节；真实解码由专用副本完成。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import { imageRefSchema } from './image-assets.ts';
import { suiteExecutionPlan, suiteExecutionReceipt } from './suite-execution.ts';
export const mediaDomains = [
  'sources',
  'inspect',
  'recipes',
  'workers',
  'captions',
  'collections',
  'reviews',
  'exchange',
  'workbench',
] as const;
export const mediaFormat = z.enum(['png', 'jpeg', 'webp', 'wav', 'mp4', 'srt']);
export const mediaName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  .refine((x) => !x.includes('..'));
export const mediaChunks = z
  .array(
    z
      .string()
      .max(700000)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  )
  .min(1)
  .max(12);
export const mediaBytes = z
  .object({
    bytes: z
      .number()
      .int()
      .min(1)
      .max(4 * 1024 ** 2),
    digest: S.suiteDigest,
    chunks: mediaChunks,
  })
  .strict();
export const mediaFacts = z
  .object({
    format: z.enum(['png', 'jpeg', 'webp', 'wav', 'mp4']),
    codec: z.string().max(40),
    audioCodec: z.string().max(40).nullable(),
    width: z.number().int().min(0).max(4096),
    height: z.number().int().min(0).max(4096),
    durationMs: z.number().int().min(0).max(60000),
    frames: z.number().int().min(0).max(10000),
    fps: z.number().min(0).max(60),
    sampleRate: z.number().int().min(0).max(192000),
    channels: z.number().int().min(0).max(8),
    rotation: z.number().int().min(0).max(270),
    orientation: z.number().int().min(1).max(8),
    alpha: z.boolean(),
    color: z.enum(['srgb-untagged', 'bt709', 'unspecified']),
    metadataKeys: z.array(z.string().max(80)).max(100),
    decoded: z.literal(true),
  })
  .strict();
const size = z
  .object({ width: z.number().int().min(16).max(1024), height: z.number().int().min(16).max(1024) })
  .strict();
export const mediaRecipe = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('image'),
      sizes: z.array(size).min(1).max(3),
      fit: z.enum(['contain', 'cover']),
      stripMetadata: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal('video'),
      width: z
        .number()
        .int()
        .min(32)
        .max(640)
        .refine((x) => x % 2 === 0),
      height: z
        .number()
        .int()
        .min(32)
        .max(360)
        .refine((x) => x % 2 === 0),
      startMs: z.number().int().min(0).max(30000),
      durationMs: z.number().int().min(100).max(15000),
      fps: z.literal(12),
      thumbnail: z.boolean(),
      stripMetadata: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal('audio'),
      startMs: z.number().int().min(0).max(60000),
      durationMs: z.number().int().min(100).max(30000),
      sampleRate: z.literal(16000),
      channels: z.literal(1),
      normalize: z.literal(true),
      stripMetadata: z.literal(true),
    })
    .strict(),
]);
export const mediaWorkerItem = z
  .object({
    key: S.suiteId,
    format: mediaFacts.shape.format,
    source: mediaBytes,
    recipe: mediaRecipe.nullable(),
  })
  .strict();
export const mediaWorkerInput = z
  .object({
    format: z.literal('sakura-media-worker/1'),
    mode: z.enum(['inspect', 'transform']),
    items: z.array(mediaWorkerItem).min(1).max(3),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.items.reduce((n, x) => n + x.source.bytes, 0) > 4 * 1024 ** 2)
      c.addIssue({ code: 'custom', message: '输入总量超过 4 MiB' });
    if (new Set(v.items.map((x) => x.key)).size !== v.items.length)
      c.addIssue({ code: 'custom', message: '重复输入标识' });
    if (v.items.some((x) => (v.mode === 'inspect' ? x.recipe !== null : x.recipe === null)))
      c.addIssue({ code: 'custom', message: '配方与任务模式不一致' });
  });
export const mediaOutput = z
  .object({ name: mediaName, format: mediaFacts.shape.format, bytes: mediaBytes, facts: mediaFacts })
  .strict();
export const mediaWorkerResult = z
  .object({
    format: z.literal('sakura-media-result/1'),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    tool: z.literal('ffmpeg-8.0.1'),
    items: z
      .array(
        z
          .object({
            key: S.suiteId,
            state: z.enum(['verified', 'failed']),
            inputDigest: S.suiteDigest,
            facts: mediaFacts.nullable(),
            outputs: z.array(mediaOutput).max(4),
            error: z.string().max(500).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    rules: z.literal('media-fixed-profiles-v1'),
  })
  .strict();
export const mediaStoredResult = mediaWorkerResult
  .extend({
    items: z
      .array(
        mediaWorkerResult.shape.items.element.extend({
          outputs: z.array(mediaOutput.extend({ bytes: mediaBytes.omit({ chunks: true }) })).max(4),
        }),
      )
      .min(1)
      .max(3),
  })
  .strict();
export const mediaPin = S.suiteScope
  .extend({ source: S.suiteRef, reviewed: z.literal(true), license: z.string().min(1).max(500) })
  .strict();
export const mediaPinned = z
  .object({
    format: z.literal('sakura-media-pinned/1'),
    source: S.suiteRef,
    license: z.string().min(1).max(500),
    reviewed: z.literal(true),
  })
  .strict();
export const mediaInspectPreview = S.suiteScope
  .extend({ sources: z.array(S.suiteRef).min(1).max(3), image: imageRefSchema, name: S.suiteName })
  .strict();
export const mediaCompile = S.suiteScope
  .extend({ inspection: S.suiteRef, item: S.suiteId, recipe: mediaRecipe, name: S.suiteName })
  .strict();
export const mediaCompiled = z
  .object({
    format: z.literal('sakura-media-recipe/1'),
    inspection: S.suiteRef,
    item: S.suiteId,
    source: S.suiteRef,
    facts: mediaFacts,
    recipe: mediaRecipe,
    rules: z.literal('media-fixed-profiles-v1'),
  })
  .strict();
export const mediaRunPreview = S.suiteScope
  .extend({ recipes: z.array(S.suiteRef).min(1).max(3), image: imageRefSchema, name: S.suiteName })
  .strict();
export const mediaAction = S.suiteScope.extend({ job: S.suiteRef }).strict();
export const mediaJobInput = z
  .object({
    name: S.suiteName,
    mode: z.enum(['inspect', 'transform']),
    sources: z.array(S.suiteRef).min(1).max(3),
    items: z
      .array(z.object({ key: S.suiteId, source: S.suiteRef, recipe: S.suiteRef.nullable() }).strict())
      .min(1)
      .max(3),
    executionPlan: suiteExecutionPlan,
  })
  .strict();
export const mediaJob = z
  .object({
    format: z.literal('sakura-media-job/1'),
    planId: S.suiteId,
    input: mediaJobInput,
    sessionId: S.suiteId,
    intentDigest: S.suiteDigest,
    session: suiteExecutionReceipt.nullable(),
    result: mediaStoredResult.nullable(),
    published: z
      .array(
        z
          .object({
            key: S.suiteId,
            name: mediaName,
            source: S.suiteRef,
            facts: mediaFacts,
            digest: S.suiteDigest,
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export const mediaDerived = S.suiteScope
  .extend({
    key: S.suiteDigest,
    name: mediaName,
    format: mediaFormat,
    lineage: z.array(S.suiteRef).min(1).max(3),
    data: mediaBytes,
  })
  .strict();
export const mediaCue = z
  .object({
    startMs: z.number().int().min(0).max(60000),
    endMs: z.number().int().min(1).max(60000),
    text: z
      .string()
      .min(1)
      .max(1000)
      .refine((x) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(x)),
  })
  .strict();
export const mediaCaptionInput = S.suiteScope
  .extend({
    name: S.suiteName,
    source: S.suiteRef,
    job: S.suiteRef,
    durationMs: z.number().int().min(1).max(60000),
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
    text: z
      .string()
      .min(1)
      .max(128 * 1024),
  })
  .strict();
export const mediaCaption = z
  .object({
    format: z.literal('sakura-media-captions/1'),
    source: S.suiteRef,
    job: S.suiteRef,
    durationMs: z.number().int().min(1).max(60000),
    language: mediaCaptionInput.shape.language,
    cues: z.array(mediaCue).min(1).max(200),
    timing: z.literal('valid'),
  })
  .strict();
export const mediaCollectionEntry = z
  .object({ name: mediaName, source: S.suiteRef, job: S.suiteRef.nullable(), caption: S.suiteRef.nullable() })
  .strict();
export const mediaAssemble = S.suiteScope
  .extend({ name: S.suiteName, entries: z.array(mediaCollectionEntry).min(1).max(24) })
  .strict();
export const mediaCollection = z
  .object({
    format: z.literal('sakura-media-collection/1'),
    entries: z
      .array(
        mediaCollectionEntry.extend({
          digest: S.suiteDigest,
          bytes: z.number().int().positive(),
          format: mediaFormat,
        }),
      )
      .min(1)
      .max(24),
  })
  .strict();
export const mediaReview = z
  .object({
    format: z.literal('sakura-media-review/1'),
    collection: S.suiteRef,
    decision: z.enum(['pending', 'accepted', 'rejected', 'withdrawn']),
    observations: z.string().max(4000),
    humanPreviewed: z.boolean(),
    checks: z.array(z.string().max(300)).max(30),
  })
  .strict();
export const mediaDecision = S.suiteScope
  .extend({
    review: S.suiteRef,
    decision: z.enum(['accepted', 'rejected', 'withdrawn']),
    observations: z.string().min(1).max(4000),
    humanPreviewed: z.literal(true),
  })
  .strict();
export const mediaSelect = <K extends string>(key: K) =>
  S.suiteScope.extend({ [key]: S.suiteRef } as Record<K, typeof S.suiteRef>).strict();
export const mediaCompare = S.suiteScope.extend({ left: S.suiteRef, right: S.suiteRef }).strict();
export const mediaTemplates = z
  .array(
    z
      .object({
        id: z.enum(['responsive-images', 'presentation-clip', 'audio-captions']),
        name: S.suiteName,
        recipe: mediaRecipe,
      })
      .strict(),
  )
  .length(3);
export const mediaView = z
  .object({
    workspaceId: S.suiteId,
    domains: z
      .array(
        z
          .object({
            domain: z.string(),
            records: z
              .array(
                z
                  .object({ reference: S.suiteRef, name: S.suiteName, state: S.suiteRecord.shape.state })
                  .strict(),
              )
              .max(20),
          })
          .strict(),
      )
      .length(9),
  })
  .strict();
