/**
 * 模块职责：保存宿主资源预留策略，在实例启动和扩容前检查可用内存及准入条件。
 * Module purpose: Stores host reservation policies and checks memory/admission before VM startup or growth.
 */
import { cpus, totalmem, freemem } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { DATA } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import { type VMRecord } from '../shared/contracts/vm.ts';
import { readStore, writeStore } from './local-store.ts';

export const reservationSchema = z
  .object({
    enabled: z.boolean().default(false),
    hostReserveMiB: z.number().int().min(0).max(1048576).default(1024),
    maxRunningCpus: z.number().int().min(1).max(1024).default(Math.max(1, cpus().length)),
    priorities: z.record(z.uuid(), z.number().int().min(0).max(100)).default({}),
  })
  .strict();
/**
 * 入口 / Entry: hostResources.
 * 功能：在保存宿主资源预留策略中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ logicalCpus: Math.max(1, cpus().length), totalMemoryMiB: Math.floor(totalmem() / 1024 ** 2), freeMemoryMiB: Math.floor(free…` 供上层消费（`resource-policies.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `resource-policies.ts`; this entry produces `{ logicalCpus: Math.max(1, cpus().length), totalMemoryMiB: Math.floor(totalmem() / 1024 ** 2), freeMemoryMiB: Math.floor(free…` for its caller. Module context: Stores host reservation policies and checks memory/admission before VM startup or growth.
 * 处理：通过 `cpus`, `totalmem`, `freemem` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `cpus`, `totalmem`, `freemem`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `{ logicalCpus: Math.max(1, cpus().length), totalMemoryMiB: Math.floor(totalmem() / 1024 ** 2), freeMemoryMiB: Math.floor(free…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function hostResources() {
  return {
    logicalCpus: Math.max(1, cpus().length),
    totalMemoryMiB: Math.floor(totalmem() / 1024 ** 2),
    freeMemoryMiB: Math.floor(freemem() / 1024 ** 2),
  };
}
/**
 * 入口 / Entry: resourcePolicy.
 * 功能：在保存宿主资源预留策略中，执行此领域的具体处理步骤并返回其结果；本入口产生 `reservationSchema.parse(await readStore(join(DATA, 'resource-policy.json'), () => ({})))` 供上层消费（`resource-policies.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `resource-policies.ts`; this entry produces `reservationSchema.parse(await readStore(join(DATA, 'resource-policy.json'), () => ({})))` for its caller. Module context: Stores host reservation policies and checks memory/admission before VM startup or growth.
 * 处理：通过 `reservationSchema.parse`, `readStore`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `reservationSchema.parse`, `readStore`, `join`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `reservationSchema.parse(await readStore(join(DATA, 'resource-policy.json'), () => ({})))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function resourcePolicy() {
  return reservationSchema.parse(await readStore(join(DATA, 'resource-policy.json'), () => ({})));
}
/**
 * 入口 / Entry: saveResourcePolicy.
 * 功能：在保存宿主资源预留策略中，校验并提交领域状态变更；本入口产生 `policy` 供上层消费（`resource-policies.ts`）。
 * Purpose: Validates and commits a domain state change in `resource-policies.ts`; this entry produces `policy` for its caller. Module context: Stores host reservation policies and checks memory/admission before VM startup or growth.
 * 处理：通过 `reservationSchema.parse`, `hostResources`, `writeStore`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `reservationSchema.parse`, `hostResources`, `writeStore`, `join`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: input: unknown
 * 输出 / Returns: `policy`.
 * 副作用 / Effects: `writeStore`.
 * 拒绝 / Refusals: 条件 / conditions `policy.hostReserveMiB >= hostResources().totalMemoryMiB`; 异常 / errors `new AppError('宿主机预留内存必须小于物理内存')`.
 */
export async function saveResourcePolicy(input: unknown) {
  const policy = reservationSchema.parse(input);
  if (policy.hostReserveMiB >= hostResources().totalMemoryMiB)
    throw new AppError('宿主机预留内存必须小于物理内存');
  await writeStore(join(DATA, 'resource-policy.json'), policy);
  return policy;
}
/**
 * 入口 / Entry: validateAdmission.
 * 功能：在保存宿主资源预留策略中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`resource-policies.ts`）。
 * Purpose: Checks admission, input or resource ownership in `resource-policies.ts`; this entry produces `void` for its caller. Module context: Stores host reservation policies and checks memory/admission before VM startup or growth.
 * 处理：通过 `running.filter`, `others.reduce` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `running.filter`, `others.reduce`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!policy.enabled`.
 * 输入 / Inputs: policy: z.infer<typeof reservationSchema>; candidate: Pick<VMRecord, 'id' | 'memoryMiB' | 'cpus'>; running: Array<Pick<VMRecord, 'id' | 'memoryMiB' | 'cpus'>>; capacity: default=hostResources()
 * 输出 / Returns: `void`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `memory + policy.hostReserveMiB > capacity.totalMemoryMiB`; `cores > policy.maxRunningCpus`; 异常 / errors `new AppError('资源预留策略阻止启动或扩容：宿主机预留内存不足', 409, 'RESOURCE_RESERVATION')`; `new AppError('资源预留策略阻止启动或扩容：运行中 vCPU 总数超过预算', 409, 'RESOURCE_RESERVATION')`.
 */
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
