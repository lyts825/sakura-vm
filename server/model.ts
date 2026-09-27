import { z } from 'zod';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirectory } from './data-directory.ts';
import type { DesktopPreferences } from './desktop-preferences.ts';
import type { SandboxPolicy } from '../shared/sandbox.ts';
import { hardwareSchema, hardwareIssues } from '../shared/hardware.ts';
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
  consistency?: 'offline' | 'filesystem';
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
};
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
