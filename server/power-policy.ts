import { join } from 'node:path';
import { z } from 'zod';
import { vmDir } from './model.ts';
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
const powerFile = (id: string) => join(vmDir(id), 'power-policy.json');
export async function powerPolicy(id: string) {
  return powerPolicySchema.parse(await readStore(powerFile(id), () => ({})));
}
export async function savePowerPolicy(id: string, input: unknown) {
  const policy = powerPolicySchema.parse(input);
  await writeStore(powerFile(id), policy);
  return policy;
}
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
