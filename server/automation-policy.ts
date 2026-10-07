/**
 * 模块职责：校验并保存维护时间窗口，按策略指定的 IANA 时区判断是否允许维护。
 * Module purpose: Validates and stores maintenance windows, evaluating eligibility in each policy's explicit IANA timezone.
 */
import { z } from 'zod';
import { join } from 'node:path';
import { vmDir } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import { withinWindow } from '../shared/time-windows.ts';

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const timeWindowSchema = z
  .object({
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, '星期不能重复'),
    start: clock,
    end: clock,
    timeZone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, '需要有效的 IANA 时区'),
  })
  .strict();
export const maintenanceSchema = z
  .object({
    enabled: z.boolean(),
    windows: z.array(timeWindowSchema).max(32),
  })
  .strict();
/**
 * 入口 / Entry: policyFile.
 * 功能：在校验并保存维护时间窗口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(id), 'automation-policy.json')` 供上层消费（`automation-policy.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `automation-policy.ts`; this entry produces `join(vmDir(id), 'automation-policy.json')` for its caller. Module context: Validates and stores maintenance windows, evaluating eligibility in each policy's explicit IANA timezone.
 * 处理：通过 `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `vmDir`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `join(vmDir(id), 'automation-policy.json')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const policyFile = (id: string) => join(vmDir(id), 'automation-policy.json');
/**
 * 入口 / Entry: maintenancePolicy.
 * 功能：在校验并保存维护时间窗口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `maintenanceSchema.parse(await readStore(policyFile(id), () => ({ enabled: false, windows: [] })))` 供上层消费（`automation-policy.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `automation-policy.ts`; this entry produces `maintenanceSchema.parse(await readStore(policyFile(id), () => ({ enabled: false, windows: [] })))` for its caller. Module context: Validates and stores maintenance windows, evaluating eligibility in each policy's explicit IANA timezone.
 * 处理：通过 `maintenanceSchema.parse`, `readStore`, `policyFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `maintenanceSchema.parse`, `readStore`, `policyFile`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `maintenanceSchema.parse(await readStore(policyFile(id), () => ({ enabled: false, windows: [] })))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function maintenancePolicy(id: string) {
  return maintenanceSchema.parse(await readStore(policyFile(id), () => ({ enabled: false, windows: [] })));
}
/**
 * 入口 / Entry: saveMaintenancePolicy.
 * 功能：在校验并保存维护时间窗口中，校验并提交领域状态变更；本入口产生 `policy` 供上层消费（`automation-policy.ts`）。
 * Purpose: Validates and commits a domain state change in `automation-policy.ts`; this entry produces `policy` for its caller. Module context: Validates and stores maintenance windows, evaluating eligibility in each policy's explicit IANA timezone.
 * 处理：通过 `maintenanceSchema.parse`, `writeStore`, `policyFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `maintenanceSchema.parse`, `writeStore`, `policyFile`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; input: unknown
 * 输出 / Returns: `policy`.
 * 副作用 / Effects: `writeStore`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function saveMaintenancePolicy(id: string, input: unknown) {
  const policy = maintenanceSchema.parse(input);
  await writeStore(policyFile(id), policy);
  return policy;
}
/**
 * 入口 / Entry: inMaintenance.
 * 功能：在校验并保存维护时间窗口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `policy.enabled && policy.windows.some((window) => withinWindow(window, now))` 供上层消费（`automation-policy.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `automation-policy.ts`; this entry produces `policy.enabled && policy.windows.some((window) => withinWindow(window, now))` for its caller. Module context: Validates and stores maintenance windows, evaluating eligibility in each policy's explicit IANA timezone.
 * 处理：通过 `maintenancePolicy`, `policy.windows.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `maintenancePolicy`, `policy.windows.some`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; now: Date | number default=Date.now()
 * 输出 / Returns: `policy.enabled && policy.windows.some((window) => withinWindow(window, now))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function inMaintenance(id: string, now: Date | number = Date.now()) {
  const policy = await maintenancePolicy(id);
  return policy.enabled && policy.windows.some((window) => withinWindow(window, now));
}
