/** 原提供者签发的短期只读采集凭据；导入的副本不能取得采集权能。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
export const incidentSnapshotTarget = z.object({ vmId: S.suiteId, projectId: z.literal('default') }).strict();
export const incidentSnapshotBinding = z
  .object({
    kind: z.enum(['metrics', 'health']),
    target: incidentSnapshotTarget,
    actorId: S.suiteId,
    consumer: z.literal('official:incident-evidence'),
    consumerGeneration: z.string().min(1).max(100),
    provider: z.enum(['official:metrics', 'official:service-health']),
    providerGeneration: z.string().min(1).max(100),
    scopeDigest: S.suiteDigest,
    snapshotDigest: S.suiteDigest,
    capturedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    authTag: S.suiteDigest,
  })
  .strict();
export const incidentSnapshot = z.object({ binding: incidentSnapshotBinding, data: S.suiteJson }).strict();
export const incidentCaptureInput = S.suiteScope
  .extend({
    kind: z.enum(['metrics', 'health']),
    target: incidentSnapshotTarget,
    name: S.suiteName,
  })
  .strict();
export type IncidentSnapshotTarget = z.infer<typeof incidentSnapshotTarget>;
export type IncidentSnapshotBinding = z.infer<typeof incidentSnapshotBinding>;
export type IncidentSnapshot = z.infer<typeof incidentSnapshot>;
