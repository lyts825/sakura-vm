/** 第七批固定领域操作、持久对象及计划的公开数据合同。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
export const seventhPayload = z.preprocess(
  (value, context) => {
    if (!S.isSuiteJsonBounded(value))
      context.addIssue({ code: 'custom', message: '输入含保留键或超出结构限制' });
    return value;
  },
  z
    .record(
      z
        .string()
        .max(128)
        .refine((k) => !['__proto__', 'prototype', 'constructor'].includes(k), '保留字段禁止作为输入键'),
      S.suiteJson,
    )
    .superRefine((v, c) => {
      if (Object.keys(v).length > 256) c.addIssue({ code: 'custom', message: '字段数超过上限' });
    }),
);
export const seventhAction = S.suiteScope
  .extend({
    name: S.suiteName.optional(),
    input: seventhPayload.default({}),
    references: z.array(S.suiteRef).max(100).default([]),
    bindings: z
      .record(
        z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
        z.union([
          S.suiteRef,
          z
            .object({
              ref: S.suiteRef,
              path: z
                .array(z.union([z.string().min(1).max(128), z.number().int().min(0).max(100000)]))
                .max(16)
                .default([]),
              encoding: z.enum(['json', 'text', 'base64']).optional(),
            })
            .strict(),
        ]),
      )
      .default({})
      .refine((v) => Object.keys(v).length <= 16, '来源绑定最多16个'),
  })
  .strict();
export type SeventhAction = z.infer<typeof seventhAction>;
export type SeventhTemplate = {
  id: string;
  name: string;
  description: string;
  domain: string;
  method: string;
  input: Record<string, unknown>;
};
export const seventhPreview = seventhAction
  .extend({ method: z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/) })
  .strict();
export const seventhUpload = S.suiteScope
  .extend({
    name: S.suiteName,
    text: z.string().max(1024 * 1024),
    format: z.enum(['json', 'csv', 'text']).default('json'),
    allowExport: z.boolean().default(false),
  })
  .strict();
export const seventhMaterialUpload = S.suiteUploadInput
  .extend({
    format: z.enum([
      'json',
      'jsonl',
      'csv',
      'text',
      'pdf',
      'png',
      'jpeg',
      'webp',
      'wasm',
      'binary',
      'image',
      'bundle',
      'wav',
      'mp4',
      'site',
    ]),
  })
  .strict();
export const seventhJob = S.suiteScope.extend({ planId: S.suiteId }).strict();
export const seventhStatus = z
  .object({
    plan: S.suitePlan,
    state: z.enum(['ready', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
    result: S.suiteRecord.nullable(),
  })
  .strict();
export interface SeventhComputePortV1 {
  execute(
    input: {
      action: string;
      input: Record<string, S.SuiteJson>;
      workspaceId?: string;
      planId?: string;
      nativeIntentId?: string;
      records?: S.SuiteRecord[];
      toolIdentity?: SeventhToolIdentity | null;
    },
    signal?: AbortSignal,
  ): Promise<S.SuiteJson>;
  toolIdentity(action: string, signal?: AbortSignal): Promise<SeventhToolIdentity | null>;
  prepareNative(
    input: { workspaceId: string; planId: string; action: string; toolIdentity: SeventhToolIdentity },
    signal?: AbortSignal,
  ): Promise<SeventhNativeTaskTicket>;
  acknowledgeNative(input: {
    workspaceId: string;
    planId: string;
    id: string;
    reference: S.SuiteRef;
  }): Promise<{ cleanup: 'confirmed' }>;
  reconcileNative(
    input: { workspaceId: string; planId: string },
    signal?: AbortSignal,
  ): Promise<{
    ticket: SeventhNativeTaskTicket;
    cleanup: 'confirmed' | 'pending' | 'unknown';
    state: string;
    output?: S.SuiteJson;
    error?: { code: string; message: string };
  }>;
  actions(): Promise<string[]>;
  lifecycle(action: string): Promise<boolean>;
}
export type SeventhToolIdentity = { manifestDigest: string; workerDigest: string; helperDigest: string };
export type SeventhNativeTaskTicket = {
  id: string;
  reservationId: string;
  workspaceId: string;
  planId: string;
  packId: string;
  action: string;
  toolIdentity: SeventhToolIdentity;
  state: string;
  digest: string;
};
export interface SeventhRecordsV1 extends S.SuiteRecordsV1 {
  save(input: S.SuiteSave): Promise<S.SuiteRecord>;
  seal(input: S.SuitePin): Promise<S.SuiteRecord>;
  previewAction(input: z.infer<typeof seventhPreview>): Promise<S.SuitePlan>;
  executeAction(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  status(input: z.infer<typeof seventhJob>): Promise<z.infer<typeof seventhStatus>>;
  cancel(input: z.infer<typeof seventhJob>): Promise<z.infer<typeof seventhStatus>>;
  reconcile(input: z.infer<typeof seventhJob>): Promise<z.infer<typeof seventhStatus>>;
  templates(input: Record<string, never>): Promise<S.SuiteJson>;
  availableActions(input: Record<string, never>): Promise<string[]>;
  view(input: S.SuiteScope): Promise<S.SuiteJson>;
}
export interface SeventhRootV1 extends SeventhRecordsV1, S.SuiteMaterialsV1 {
  archive: {
    (input: S.SuitePin): Promise<S.SuiteRecord>;
    (input: S.SuiteScope & { expectedRevision: number }): Promise<S.SuiteWorkspace>;
  };
}
export interface SeventhMaterialsV1 extends SeventhRecordsV1, S.SuiteByteMaterialsV1 {
  beginUpload(input: z.input<typeof seventhMaterialUpload>): Promise<S.SuiteUpload>;
}
export interface SeventhVmV1 extends SeventhRecordsV1 {
  tool(): Promise<z.infer<typeof import('./seventh-execution.ts').suiteExecutionTool>>;
  images(): Promise<import('./image-assets.ts').ImageAsset[]>;
  beginImageImport(
    input: Pick<
      import('./image-assets.ts').ImageUpload,
      'digest' | 'bytes' | 'distro' | 'architecture' | 'source'
    >,
  ): Promise<import('./image-assets.ts').ImageUpload>;
  appendImageImport(input: {
    id: string;
    offset: number;
    data: string;
  }): Promise<import('./image-assets.ts').ImageUpload>;
  finishImageImport(input: { id: string }): Promise<import('./image-assets.ts').ImageAsset>;
  imageImports(input: Record<string, never>): Promise<import('./image-assets.ts').ImageUpload[]>;
  discardImageImport(input: { id: string }): Promise<{ discarded: true }>;
  verifyImage(input: import('./image-assets.ts').ImageRef): Promise<import('./image-assets.ts').ImageAsset>;
}
