/**
 * 模块职责：实例配置、持久化记录和公开视图契约，同时校验创建、组织和高可用/迁移身份数据。
 */
import { z } from 'zod';
import type { DesktopPreferences } from '../desktop-preferences.ts';
import type { SandboxPolicy } from '../sandbox.ts';
import { hardwareSchema, hardwareIssues } from '../hardware.ts';
import { recoveryOriginSchema } from './domain-recovery.ts';
export type DiskEncryptionConfig = { format: 'luks'; secretName: string };
export const BOOT_TIMEOUT_MS = 270_000;
export type MigrationFingerprint = { recordHash: string; diskSize: number; diskMtimeMs: number };

export const createSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[a-z][a-z0-9-]*$/, '名称以小写字母开头，仅含字母、数字和短横线'),
    memoryMiB: z.number().int().min(256).max(8192).default(512),
    cpus: z.number().int().min(1).max(8).default(2),
    diskGiB: z.number().int().min(2).max(128).default(8),
    storagePoolId: z
      .string()
      .regex(/^(default|[a-f0-9]{16})$/)
      .optional(),
    accelerator: z.enum(['auto', 'tcg', 'whpx']).default('auto'),
    firmware: z.enum(['bios', 'uefi']).optional(),
    distro: z.enum(['alpine', 'debian', 'ubuntu']).optional(),
    architecture: z.enum(['x86_64', 'aarch64']).optional(),
    template: z.enum(['none', 'node', 'python', 'rust']).optional(),
    hardware: hardwareSchema.optional(),
    forwards: z
      .array(
        z.object({
          name: z.string().trim().max(40).optional(),
          host: z.number().int().min(1024).max(65535),
          guest: z.number().int().min(1).max(65535),
        }),
      )
      .max(12)
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const message of hardwareIssues(v)) ctx.addIssue({ code: 'custom', message, path: ['hardware'] });
    if (v.architecture === 'aarch64') {
      if (v.distro !== 'debian')
        ctx.addIssue({ code: 'custom', message: 'ARM64 当前支持 Debian 12', path: ['distro'] });
      if (v.firmware !== 'uefi')
        ctx.addIssue({ code: 'custom', message: 'ARM64 需要 UEFI 固件', path: ['firmware'] });
      if (v.accelerator === 'whpx')
        ctx.addIssue({ code: 'custom', message: 'ARM64 在 Windows 上使用 TCG', path: ['accelerator'] });
    }
    if (new Set(v.forwards.map((p) => p.host)).size !== v.forwards.length)
      ctx.addIssue({ code: 'custom', message: '主机端口不能重复', path: ['forwards'] });
  });
export type VMConfig = z.infer<typeof createSchema>;
export type VMStatus = 'stopped' | 'starting' | 'running' | 'paused' | 'stopping' | 'error';
export type DesktopView = {
  status: 'unavailable' | 'not-installed' | 'installing' | 'starting' | 'stopped' | 'ready' | 'error';
  log: string;
  error?: string;
  preferences?: DesktopPreferences;
  projectId?: string;
  directory?: string;
  networkIsolation?: 'host' | 'private';
  bindingMismatch?: boolean;
  cleanupPending?: boolean;
};
export type Snapshot = {
  id: string;
  name: string;
  createdAt: string;
  note?: string;
  diskGiB?: number;
  pendingResize?: boolean;
  consistency?: 'offline' | 'filesystem' | 'vmstate';
  stateFingerprint?: string;
};
export const organizationSchema = z
  .object({
    group: z.string().trim().max(40).default(''),
    tags: z.array(z.string().trim().min(1).max(24)).max(12).default([]),
    favorite: z.boolean().default(false),
  })
  .strict();
export type VMRecord = VMConfig & {
  id: string;
  diskEncryption?: DiskEncryptionConfig;
  sandbox?: SandboxPolicy;
  // Only the rescue executor creates these disposable guests. They cannot be restarted.
  rescueOf?: string;
  createdAt: string;
  snapshots: Snapshot[];
  // New disks use the serial readiness marker before the first SSH probe.
  // It remains optional so older records keep their existing startup path.
  bootstrapped?: boolean;
  lastUsedAt?: string;
  lastError?: string;
  organization?: z.infer<typeof organizationSchema>;
  pendingResize?: boolean;
  migrationOrigin?: {
    sourceHostId: string;
    transferId: string;
    targetName: string;
    sourceVmId?: string;
    snapshotId?: string;
    diskSha256?: string;
  };
  haPromotion?: HaPromotion;
  haRetirement?: HaRetirement;
  haWitnessEnrollment?: HaWitnessEnrollment;
  liveMigrationFence?: LiveMigrationFence;
  liveMigrationOrigin?: LiveMigrationOrigin;
  // Snapshot clones retain an independent baseline disk for three-way workspace merges.
  branchOrigin?: { sourceVmId: string; snapshotId: string; createdAt: string };
  mergeOrigin?: {
    branchVmId: string;
    targetVmId: string;
    snapshotId: string;
    path: string;
    mergedAt: string;
    appliedFiles: number;
  };
};
export const haPromotionSchema = z
  .object({
    peerId: z.uuid(),
    targetHostId: z.uuid(),
    transferId: z.uuid(),
    remoteVmId: z.uuid(),
    snapshotId: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    fencedAt: z.iso.datetime(),
    status: z.enum(['fenced', 'accepted']),
    updatedAt: z.iso.datetime(),
    error: z.string().max(500).optional(),
  })
  .strict();
export type HaPromotion = z.infer<typeof haPromotionSchema>;
export const haWitnessEnrollmentSchema = z
  .object({
    targetHostId: z.uuid(),
    failureThreshold: z.number().int().min(2).max(10),
    registeredAt: z.iso.datetime(),
  })
  .strict();
export type HaWitnessEnrollment = z.infer<typeof haWitnessEnrollmentSchema>;
export const haRetirementSchema = z
  .object({
    sourceHostId: z.uuid(),
    transferId: z.uuid(),
    sourceVmId: z.uuid(),
    snapshotId: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    retiredAt: z.iso.datetime(),
  })
  .strict();
export type HaRetirement = z.infer<typeof haRetirementSchema>;
export const liveMigrationCompletionSchema = z.object({
  version: z.literal(1),
  sourceVmId: z.uuid(), sourceHostId: z.uuid(), sourceProcessId: z.uuid(),
  targetHostId: z.uuid(), targetVmId: z.uuid(), transferId: z.uuid(), sessionId: z.uuid(),
  projectsDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceStoppedAt: z.iso.datetime(), targetVerifiedAt: z.iso.datetime(), confirmedAt: z.iso.datetime(),
}).strict();
export const liveMigrationFenceIdentitySchema = z
  .object({
    targetHostId: z.uuid(),
    targetVmId: z.uuid(),
    transferId: z.uuid(),
    fencedAt: z.iso.datetime(),
    // Optional for records written before durable completion verification was introduced.
    peerId: z.uuid().optional(), sourceHostId: z.uuid().optional(), sessionId: z.uuid().optional(),
    projectsDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), sourceProcessId: z.uuid().optional(),
    origin: recoveryOriginSchema.optional(),
  })
  .strict();
export const liveMigrationFenceSchema = liveMigrationFenceIdentitySchema.extend({
  sourceStopped: z.object({ sourceProcessId: z.uuid(), stoppedAt: z.iso.datetime() }).strict().optional(),
  completion: liveMigrationCompletionSchema.optional(),
}).superRefine((fence, context) => {
  if (fence.sourceStopped && fence.sourceStopped.sourceProcessId !== fence.sourceProcessId)
    context.addIssue({ code: 'custom', path: ['sourceStopped'], message: '来源停止回执不属于原进程' });
  if (fence.completion) {
    const proof = fence.completion;
    if (!fence.peerId || !fence.sourceStopped ||
      proof.sourceStoppedAt !== fence.sourceStopped.stoppedAt ||
      ['sourceHostId', 'sourceProcessId', 'targetHostId', 'targetVmId', 'transferId', 'sessionId', 'projectsDigest']
        .some(key => proof[key as keyof typeof proof] !== fence[key as keyof typeof fence]))
      context.addIssue({ code: 'custom', path: ['completion'], message: '完成证明与原迁移票据不匹配' });
  }
});
export type LiveMigrationFence = z.infer<typeof liveMigrationFenceSchema>;
export const liveMigrationOriginSchema = z
  .object({
    sourceHostId: z.uuid(),
    sourceVmId: z.uuid(),
    transferId: z.uuid(),
    status: z.enum(['prepared', 'received', 'ready']),
    completionProtocol: z.literal(1).optional(),
    sessionId: z.uuid().optional(), projectsDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    prepareDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    prepareReceipt: z.object({
      targetVmId: z.uuid(), sessionId: z.uuid(), targetDiskNode: z.string().min(1).max(64),
      diskPort: z.number().int().min(1024).max(65535), statePort: z.number().int().min(1024).max(65535),
      completionProtocol: z.literal(1).optional(),
    }).strict().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict().superRefine((origin, context) => {
    if (origin.prepareReceipt && (origin.prepareReceipt.sessionId !== origin.sessionId ||
        origin.prepareReceipt.completionProtocol !== origin.completionProtocol))
      context.addIssue({ code: 'custom', path: ['prepareReceipt'], message: '准备回执不属于原迁移会话' });
  });
export type LiveMigrationOrigin = z.infer<typeof liveMigrationOriginSchema>;
export type VMView = VMRecord & {
  activeAccelerator?: 'tcg' | 'whpx';
  memoryTargetMiB?: number;
  status: VMStatus;
  poweredOn: boolean;
  startedAt?: string;
  diskBytes: number;
};
