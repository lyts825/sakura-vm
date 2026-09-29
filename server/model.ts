import { z } from 'zod';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirectory } from './data-directory.ts';
import type { DesktopPreferences } from './desktop-preferences.ts';
import type { SandboxPolicy } from '../shared/sandbox.ts';
import { hardwareSchema, hardwareIssues } from '../shared/hardware.ts';
import type { DiskEncryptionConfig } from './disk-encryption.ts';
export { desktopPreferencesSchema, defaultDesktopPreferences } from './desktop-preferences.ts';
export type { DesktopPreferences } from './desktop-preferences.ts';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DATA = dataDirectory(process.env.SAKURA_DATA_DIR || join(ROOT, '.data'));
export const VM_ROOT = join(DATA, 'machines');
const vmStorageRoots = new Map<string, string>();
export function setVmStorageRoot(id: string, root?: string) {
  checkedId(id);
  if (root) vmStorageRoots.set(id, resolve(root));
  else vmStorageRoots.delete(id);
}
export const IMAGE = resolve(process.env.SAKURA_IMAGE_PATH || join(DATA, 'images', 'alpine-3.23.qcow2'));
export const PORT = Number(process.env.SAKURA_PORT || 7337);
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
    storagePoolId: z.string().regex(/^(default|[a-f0-9]{16})$/).optional(),
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
  migrationOrigin?: { sourceHostId: string; transferId: string; targetName: string;
    sourceVmId?: string; snapshotId?: string; diskSha256?: string };
  haPromotion?: HaPromotion;
  haRetirement?: HaRetirement;
  haWitnessEnrollment?: HaWitnessEnrollment;
  liveMigrationFence?: LiveMigrationFence;
  liveMigrationOrigin?: LiveMigrationOrigin;
  // Snapshot clones retain an independent baseline disk for three-way workspace merges.
  branchOrigin?: { sourceVmId: string; snapshotId: string; createdAt: string };
  mergeOrigin?: { branchVmId: string; targetVmId: string; snapshotId: string;
    path: string; mergedAt: string; appliedFiles: number };
};
export const haPromotionSchema = z.object({
  peerId: z.uuid(), targetHostId: z.uuid(), transferId: z.uuid(),
  remoteVmId: z.uuid(), snapshotId: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  fencedAt: z.iso.datetime(), status: z.enum(['fenced', 'accepted']),
  updatedAt: z.iso.datetime(), error: z.string().max(500).optional(),
}).strict();
export type HaPromotion = z.infer<typeof haPromotionSchema>;
export const haWitnessEnrollmentSchema = z.object({
  targetHostId: z.uuid(), failureThreshold: z.number().int().min(2).max(10),
  registeredAt: z.iso.datetime(),
}).strict();
export type HaWitnessEnrollment = z.infer<typeof haWitnessEnrollmentSchema>;
export const haRetirementSchema = z.object({
  sourceHostId: z.uuid(), transferId: z.uuid(), sourceVmId: z.uuid(),
  snapshotId: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  retiredAt: z.iso.datetime(),
}).strict();
export type HaRetirement = z.infer<typeof haRetirementSchema>;
export const liveMigrationFenceSchema = z.object({
  targetHostId: z.uuid(), targetVmId: z.uuid(), transferId: z.uuid(),
  fencedAt: z.iso.datetime(),
}).strict();
export type LiveMigrationFence = z.infer<typeof liveMigrationFenceSchema>;
export const liveMigrationOriginSchema = z.object({
  sourceHostId: z.uuid(), sourceVmId: z.uuid(), transferId: z.uuid(),
  status: z.enum(['prepared', 'received', 'ready']),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
export type LiveMigrationOrigin = z.infer<typeof liveMigrationOriginSchema>;
export type VMView = VMRecord & {
  activeAccelerator?: 'tcg' | 'whpx';
  memoryTargetMiB?: number;
  status: VMStatus;
  poweredOn: boolean;
  startedAt?: string;
  diskBytes: number;
};
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: string,
  ) {
    super(message);
  }
}
export function checkedId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    throw new AppError('无效的实例标识', 400);
  return id;
}
export function vmDir(id: string) {
  const checked = checkedId(id);
  return join(vmStorageRoots.get(checked) || VM_ROOT, checked);
}
export function guestPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || /[\x00-\x1f]/.test(value))
    throw new AppError('需要有效的 Linux 绝对路径');
  return value;
}
