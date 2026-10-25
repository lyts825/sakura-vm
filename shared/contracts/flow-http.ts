/** 请求只能进入固定领域方法；内部意图、批准消费及原提供者派发不开放 HTTP。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as F from './flow-studio.ts';
import {
  suiteMethod as method,
  suiteControls as controls,
  suiteMaterialMethods,
  suiteExchangeMethods,
  suiteEmpty,
} from './suite-http.ts';
export const flowUpload = S.suiteScope
  .extend({ name: S.suiteName, text: z.string().max(1024 * 1024), allowExport: z.boolean().default(false) })
  .strict();
export const flowTimeline = S.suiteScope
  .extend({
    runId: S.suiteId,
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
const {
  hostCapacity,
  createWorkspace,
  listWorkspaces,
  workspace,
  revokeWorkspace,
  capacity,
  ...materialMethods
} = suiteMaterialMethods();
const workspaceMethods = {
  hostCapacity,
  createWorkspace,
  listWorkspaces,
  workspace,
  revokeWorkspace,
  capacity,
};
export const flowHttpSchemas = {
  definitions: {
    ...controls(),
    ...workspaceMethods,
    compile: method(F.flowCompile, S.suiteRecord),
    validate: method(
      F.flowSelect('definition'),
      z.object({ valid: z.literal(true), order: z.array(F.flowNodeId).max(24) }).strict(),
      true,
    ),
  },
  inputs: {
    ...materialMethods,
    upload: method(flowUpload, S.suiteRecord),
    bind: method(F.flowBind, S.suiteRecord),
    resolve: method(
      F.flowSelect('inputs').extend({ name: F.flowBinding }).strict(),
      z
        .object({ value: z.union([z.string(), z.number(), z.boolean(), z.null()]), digest: S.suiteDigest })
        .strict(),
      true,
    ),
  },
  connectors: {
    ...controls(),
    catalogue: method(
      suiteEmpty,
      z
        .array(z.object({ adapter: z.string(), available: z.boolean(), description: z.string() }).strict())
        .max(2),
      true,
    ),
    inspectProvider: method(
      z.object({ target: F.flowProviderInput }).strict(),
      z.object({ available: z.boolean(), adapter: z.string() }).strict(),
      true,
    ),
  },
  plans: {
    ...controls(),
    previewFlow: method(F.flowPreview, S.suiteRecord),
    invalidate: method(F.flowSelect('plan'), S.suiteRecord),
    inspect: method(F.flowSelect('plan'), S.suiteRecord, true),
  },
  approvals: {
    ...controls(),
    approve: method(F.flowApprove, S.suiteRecord),
    revoke: method(F.flowRevoke, S.suiteRecord),
    inspect: method(F.flowSelect('approval'), S.suiteRecord, true),
  },
  journal: {
    ...controls(),
    readTimeline: method(flowTimeline, S.suitePage, true),
    verify: method(
      S.suiteScope.extend({ runId: S.suiteId }).strict(),
      z.object({ valid: z.literal(true), events: z.number().int(), tail: S.suiteDigest.nullable() }).strict(),
      true,
    ),
  },
  runs: {
    ...controls(),
    start: method(F.flowSelect('plan'), S.suiteRecord),
    inspect: method(F.flowRunKey, S.suiteRecord, true),
    previewStep: method(F.flowNodeKey, S.suiteRecord),
    advance: method(F.flowAdvance, S.suiteRecord),
    cancel: method(F.flowRunKey, S.suiteRecord),
    reconcile: method(F.flowNodeKey, S.suiteRecord),
  },
  timers: {
    ...controls(),
    scheduleWait: method(F.flowWait, S.suiteRecord),
    due: method(
      S.suiteScope,
      z.array(z.object({ timer: S.suiteRecord, due: z.boolean() }).strict()).max(100),
      true,
    ),
    release: method(F.flowSelect('timer'), S.suiteRecord),
    cancelWait: method(F.flowSelect('timer'), S.suiteRecord),
  },
  exchange: suiteExchangeMethods(),
  workbench: {
    ...controls(),
    view: method(F.flowViewRequest, F.flowView, true),
    templates: method(suiteEmpty, z.array(F.flowTemplate).max(4), true),
  },
} as const;
export type FlowDomain = keyof typeof flowHttpSchemas;
export const flowHttpRequests = Object.fromEntries(
  Object.entries(flowHttpSchemas).flatMap(([d, methods]) =>
    Object.entries(methods).map(([id, s]) => [`flow-${d}.${id}`, s.request]),
  ),
);
export const flowHttpResponses = Object.fromEntries(
  Object.entries(flowHttpSchemas).flatMap(([d, methods]) =>
    Object.entries(methods).map(([id, s]) => [`flow-${d}.${id}`, s.response]),
  ),
);
