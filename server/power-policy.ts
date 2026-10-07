/**
 * 模块职责：保存宿主电源策略并计算启停决策，使用不同电池阈值避免频繁反复切换。
 * Module purpose: Stores power policies and computes start/stop decisions using separate battery thresholds to avoid oscillation.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { vmDir } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import { windowsProbe } from './windows-probe.ts';

export const powerPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    allowBatteryStarts: z.boolean().default(false),
    minimumBatteryPercent: z.number().int().min(0).max(100).default(30),
    stopBelowPercent: z.number().int().min(0).max(50).default(0),
  })
  .strict()
  .refine(
    (value) => value.stopBelowPercent === 0 || value.minimumBatteryPercent > value.stopBelowPercent,
    '电池开机阈值必须高于关机阈值',
  );
export type PowerPolicy = z.infer<typeof powerPolicySchema>;
export type PowerSample = {
  checkedAt: string;
  onAC: boolean | null;
  batteryPresent: boolean | null;
  batteryPercent: number | null;
  error?: string;
};
/**
 * 入口 / Entry: powerFile.
 * 功能：在保存宿主电源策略并计算启停决策中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(id), 'power-policy.json')` 供上层消费（`power-policy.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `power-policy.ts`; this entry produces `join(vmDir(id), 'power-policy.json')` for its caller. Module context: Stores power policies and computes start/stop decisions using separate battery thresholds to avoid oscillation.
 * 处理：通过 `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `vmDir`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `join(vmDir(id), 'power-policy.json')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const powerFile = (id: string) => join(vmDir(id), 'power-policy.json');
/**
 * 入口 / Entry: powerPolicy.
 * 功能：在保存宿主电源策略并计算启停决策中，执行此领域的具体处理步骤并返回其结果；本入口产生 `powerPolicySchema.parse(await readStore(powerFile(id), () => ({})))` 供上层消费（`power-policy.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `power-policy.ts`; this entry produces `powerPolicySchema.parse(await readStore(powerFile(id), () => ({})))` for its caller. Module context: Stores power policies and computes start/stop decisions using separate battery thresholds to avoid oscillation.
 * 处理：通过 `powerPolicySchema.parse`, `readStore`, `powerFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `powerPolicySchema.parse`, `readStore`, `powerFile`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `powerPolicySchema.parse(await readStore(powerFile(id), () => ({})))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function powerPolicy(id: string) {
  return powerPolicySchema.parse(await readStore(powerFile(id), () => ({})));
}
/**
 * 入口 / Entry: savePowerPolicy.
 * 功能：在保存宿主电源策略并计算启停决策中，校验并提交领域状态变更；本入口产生 `policy` 供上层消费（`power-policy.ts`）。
 * Purpose: Validates and commits a domain state change in `power-policy.ts`; this entry produces `policy` for its caller. Module context: Stores power policies and computes start/stop decisions using separate battery thresholds to avoid oscillation.
 * 处理：通过 `powerPolicySchema.parse`, `writeStore`, `powerFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `powerPolicySchema.parse`, `writeStore`, `powerFile`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; input: unknown
 * 输出 / Returns: `policy`.
 * 副作用 / Effects: `writeStore`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function savePowerPolicy(id: string, input: unknown) {
  const policy = powerPolicySchema.parse(input);
  await writeStore(powerFile(id), policy);
  return policy;
}
/**
 * 入口 / Entry: powerDecision.
 * 功能：在保存宿主电源策略并计算启停决策中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ allowStart: true, stop: false, reason: '电源策略未启用' }` / `{ allowStart: false, stop: false, reason: '电源状态未知或已过期，暂停自动开机' }` 供上层消费（`power-policy.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `power-policy.ts`; this entry produces `{ allowStart: true, stop: false, reason: '电源策略未启用' }` / `{ allowStart: false, stop: false, reason: '电源状态未知或已过期，暂停自动开机' }` for its caller. Module context: Stores power policies and computes start/stop decisions using separate battery thresholds to avoid oscillation.
 * 分支 / Branches: `!policy.enabled`; `!Number.isFinite(age) || age < 0 || age > 90000 || sample.onAC === null`; `sample.onAC`.
 * 输入 / Inputs: policy: PowerPolicy; sample: PowerSample; now: default=Date.now()
 * 输出 / Returns: `{ allowStart: true, stop: false, reason: '电源策略未启用' }`; `{ allowStart: false, stop: false, reason: '电源状态未知或已过期，暂停自动开机' }`; `{ allowStart: true, stop: false, reason: '正在使用交流电' }`；另有分支返回 / additional branch-specific returns.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function powerDecision(policy: PowerPolicy, sample: PowerSample, now = Date.now()) {
  const age = now - Date.parse(sample.checkedAt);
  if (!policy.enabled) return { allowStart: true, stop: false, reason: '电源策略未启用' };
  if (!Number.isFinite(age) || age < 0 || age > 90000 || sample.onAC === null)
    return { allowStart: false, stop: false, reason: '电源状态未知或已过期，暂停自动开机' };
  if (sample.onAC) return { allowStart: true, stop: false, reason: '正在使用交流电' };
  const knownBattery =
    sample.batteryPresent === true &&
    sample.batteryPercent !== null &&
    Number.isFinite(sample.batteryPercent) &&
    sample.batteryPercent >= 0 &&
    sample.batteryPercent <= 100;
  const stop =
    knownBattery && policy.stopBelowPercent > 0 && sample.batteryPercent! <= policy.stopBelowPercent;
  return {
    allowStart:
      !stop &&
      policy.allowBatteryStarts &&
      knownBattery &&
      sample.batteryPercent! >= policy.minimumBatteryPercent,
    stop,
    reason: stop
      ? '电量达到关机阈值'
      : !policy.allowBatteryStarts
        ? '电池供电期间暂停自动开机'
        : !knownBattery
          ? '电池电量未知，暂停自动开机'
          : sample.batteryPercent! < policy.minimumBatteryPercent
            ? '电量低于自动开机阈值'
            : '电量满足自动开机条件',
  };
}
/**
 * 入口 / Entry: hostPower.
 * 功能：在保存宿主电源策略并计算启停决策中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ checkedAt, onAC: raw.line === 1 ? true : raw.line === 0 ? false : null, batteryPresent: present, batteryPercent: present &&…` / `{ checkedAt, onAC: null, batteryPresent: null, batteryPercent: null, error: String((error as Error).message || error), }` 供上层消费（`power-policy.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `power-policy.ts`; this entry produces `{ checkedAt, onAC: raw.line === 1 ? true : raw.line === 0 ? false : null, batteryPresent: present, batteryPercent: present &&…` / `{ checkedAt, onAC: null, batteryPresent: null, batteryPercent: null, error: String((error as Error).message || error), }` for its caller. Module context: Stores power policies and computes start/stop decisions using separate battery thresholds to avoid oscillation.
 * 处理：通过 `z.object().parse`, `z.object`, `z.number().int`, `z.number` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.object().parse`, `z.object`, `z.number().int`, `z.number`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: signal: AbortSignal optional
 * 输出 / Returns: Promise<PowerSample>；结果来自 / values from `{ checkedAt, onAC: raw.line === 1 ? true : raw.line === 0 ? false : null, batteryPresent: present, batteryPercent: present &&…`; `{ checkedAt, onAC: null, batteryPresent: null, batteryPercent: null, error: String((error as Error).message || error), }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `signal?.throwIfAborted();`; `return { checkedAt, onAC: null, batteryPresent: null, batteryPercent: null, error: String((error as Error).message || error),…`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `signal?.throwIfAborted();`; `return { checkedAt, onAC: null, batteryPresent: null, batteryPercent: null, error: String((error as Error).message || error),…`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function hostPower(signal?: AbortSignal): Promise<PowerSample> {
  const checkedAt = new Date().toISOString();
  try {
    const raw = z.object({ line: z.number().int(), flags: z.number().int(), fraction: z.number() }).parse(
      await windowsProbe(
        String.raw`Add-Type -AssemblyName System.Windows.Forms
$status=[System.Windows.Forms.SystemInformation]::PowerStatus
@{line=[int]$status.PowerLineStatus; flags=[int]$status.BatteryChargeStatus; fraction=[double]$status.BatteryLifePercent} | ConvertTo-Json -Compress`,
        {},
        signal,
      ),
    );
    const present = raw.flags === 255 ? null : (raw.flags & 128) === 0;
    return {
      checkedAt,
      onAC: raw.line === 1 ? true : raw.line === 0 ? false : null,
      batteryPresent: present,
      batteryPercent:
        present && raw.fraction >= 0 && raw.fraction <= 1 ? Math.round(raw.fraction * 100) : null,
    };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      checkedAt,
      onAC: null,
      batteryPresent: null,
      batteryPercent: null,
      error: String((error as Error).message || error),
    };
  }
}
