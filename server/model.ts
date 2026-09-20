import { z } from 'zod';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DATA = resolve(process.env.SAKURA_DATA_DIR || join(ROOT, '.data'));
export const VM_ROOT = join(DATA, 'machines');
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
    accelerator: z.enum(['auto', 'tcg', 'whpx']).default('auto'),
    distro: z.enum(['alpine', 'debian', 'ubuntu']).optional(),
    template: z.enum(['none', 'node', 'python', 'rust']).optional(),
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
    if (new Set(v.forwards.map((p) => p.host)).size !== v.forwards.length)
      ctx.addIssue({ code: 'custom', message: '主机端口不能重复', path: ['forwards'] });
  });
export type VMConfig = z.infer<typeof createSchema>;
export type VMStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export type DesktopView = {
  status: 'unavailable' | 'not-installed' | 'installing' | 'starting' | 'stopped' | 'ready' | 'error';
  log: string;
  error?: string;
};
export type Snapshot = { id: string; name: string; createdAt: string; note?: string };
export type VMRecord = VMConfig & {
  id: string;
  createdAt: string;
  snapshots: Snapshot[];
  lastError?: string;
};
export type VMView = VMRecord & {
  activeAccelerator?: 'tcg' | 'whpx';
  status: VMStatus;
  poweredOn: boolean;
  startedAt?: string;
  diskBytes: number;
};
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
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
  return join(VM_ROOT, checkedId(id));
}
export function guestPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || /[\x00-\x1f]/.test(value))
    throw new AppError('需要有效的 Linux 绝对路径');
  return value;
}
