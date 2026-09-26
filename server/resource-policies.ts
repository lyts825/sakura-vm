import { cpus, totalmem, freemem } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { DATA, AppError, type VMRecord } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

export const reservationSchema = z
  .object({
    enabled: z.boolean().default(false),
    hostReserveMiB: z.number().int().min(0).max(1048576).default(1024),
    maxRunningCpus: z.number().int().min(1).max(1024).default(Math.max(1, cpus().length)),
    priorities: z.record(z.uuid(), z.number().int().min(0).max(100)).default({}),
  })
  .strict();
export function hostResources() {
  return {
    logicalCpus: Math.max(1, cpus().length),
    totalMemoryMiB: Math.floor(totalmem() / 1024 ** 2),
    freeMemoryMiB: Math.floor(freemem() / 1024 ** 2),
  };
}
export async function resourcePolicy() {
  return reservationSchema.parse(await readStore(join(DATA, 'resource-policy.json'), () => ({})));
}
export async function saveResourcePolicy(input: unknown) {
  const policy = reservationSchema.parse(input);
  if (policy.hostReserveMiB >= hostResources().totalMemoryMiB)
    throw new AppError('宿主机预留内存必须小于物理内存');
  await writeStore(join(DATA, 'resource-policy.json'), policy);
  return policy;
}
export function validateAdmission(
  policy: z.infer<typeof reservationSchema>,
  candidate: Pick<VMRecord, 'id' | 'memoryMiB' | 'cpus'>,
  running: Array<Pick<VMRecord, 'id' | 'memoryMiB' | 'cpus'>>,
  capacity = hostResources(),
) {
  if (!policy.enabled) return;
  const others = running.filter((vm) => vm.id !== candidate.id);
  const memory = others.reduce((sum, vm) => sum + vm.memoryMiB, candidate.memoryMiB);
  const cores = others.reduce((sum, vm) => sum + vm.cpus, candidate.cpus);
  if (memory + policy.hostReserveMiB > capacity.totalMemoryMiB)
    throw new AppError('资源预留策略阻止启动或扩容：宿主机预留内存不足', 409, 'RESOURCE_RESERVATION');
  if (cores > policy.maxRunningCpus)
    throw new AppError('资源预留策略阻止启动或扩容：运行中 vCPU 总数超过预算', 409, 'RESOURCE_RESERVATION');
}
