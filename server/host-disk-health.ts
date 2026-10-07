/**
 * 模块职责：读取宿主卷容量并评估磁盘健康阈值，提供维护前可检查的容量证据。
 * Module purpose: Reads host volume capacity and evaluates health thresholds to provide evidence before maintenance.
 */
import { access, realpath, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { z } from 'zod';
import { DATA } from './paths.ts';
import { windowsProbe } from './windows-probe.ts';

export const diskHealthThresholds = z
  .object({
    minimumFreeGiB: z.number().min(0).max(4096).default(10),
    minimumFreePercent: z.number().min(0).max(100).default(5),
    maximumTemperatureC: z.number().min(20).max(120).default(70),
    maximumWearPercent: z.number().min(1).max(100).default(90),
  })
  .strict();
const counter = z.number().finite().nonnegative().nullable().default(null);
const observationSchema = z.object({
  volume: z
    .object({ health: z.string(), operational: z.array(z.string()), filesystem: z.string() })
    .nullable(),
  volumeError: z.string().nullable().default(null),
  disks: z
    .array(
      z.object({
        number: z.number().int().nonnegative(),
        name: z.string(),
        bus: z.string(),
        health: z.string(),
        operational: z.array(z.string()),
        counters: z
          .object({
            temperatureC: counter,
            maximumTemperatureC: counter,
            wearPercent: counter,
            powerOnHours: counter,
            readErrorsUncorrected: counter,
            writeErrorsUncorrected: counter,
          })
          .nullable(),
        countersError: z.string().nullable().default(null),
      }),
    )
    .max(256),
});

const diskProbe = String.raw`
$volume=$null; $volumeError=$null; $disks=@()
try {
  $volume=Get-Volume -FilePath $request.directory
  if ($null -eq $volume) { throw 'The data directory could not be mapped to a local volume.' }
  $devices=@(Get-Partition -Volume $volume | Get-Disk | Sort-Object Number -Unique)
  foreach ($device in $devices) {
    $counters=$null; $counterError=$null
    try {
      $value=Get-StorageReliabilityCounter -Disk $device
      if ($null -eq $value) { throw 'The storage provider returned no reliability counters.' }
      $counters=@{temperatureC=$value.Temperature; maximumTemperatureC=$value.TemperatureMax; wearPercent=$value.Wear; powerOnHours=$value.PowerOnHours; readErrorsUncorrected=$value.ReadErrorsUncorrected; writeErrorsUncorrected=$value.WriteErrorsUncorrected}
    } catch { $counterError=$_.Exception.Message }
    $disks+=@{number=[int]$device.Number; name=[string]$device.FriendlyName; bus=[string]$device.BusType; health=[string]$device.HealthStatus; operational=@($device.OperationalStatus | ForEach-Object { [string]$_ }); counters=$counters; countersError=$counterError}
  }
} catch { $volumeError=$_.Exception.Message }
$volumeView=$null
if ($null -ne $volume) { $volumeView=@{health=[string]$volume.HealthStatus; operational=@($volume.OperationalStatus | ForEach-Object { [string]$_ }); filesystem=[string]$volume.FileSystemType} }
@{volume=$volumeView; volumeError=$volumeError; disks=@($disks)} | ConvertTo-Json -Depth 8 -Compress
`;

/**
 * 入口 / Entry: evaluateDiskHealth.
 * 功能：把宿主容量、错误与性能样本按阈值归类为磁盘健康结果。
 * Purpose: Classifies capacity/error/performance samples into disk-health results using configured thresholds.
 * 设计：缺失样本保留未知或检查失败，而不是用零值证明健康；结果仅评价提供的实际证据。
 * Design: Missing samples remain unknown/failing instead of treating zero as healthy; conclusions use supplied measured evidence.
 * 输入 / Inputs: input: unknown; capacity: { totalBytes: number; availableBytes: number }; thresholdsInput: unknown
 * 输出 / Returns: `{ ...observation, capacity: { ...capacity, freePercent }, thresholds, findings, status: findings.some((item) => item.severity…`.
 * 副作用 / Effects: `findings.push`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function evaluateDiskHealth(
  input: unknown,
  capacity: { totalBytes: number; availableBytes: number },
  thresholdsInput: unknown,
) {
  const observation = observationSchema.parse(input),
    thresholds = diskHealthThresholds.parse(thresholdsInput);
  const freePercent = capacity.totalBytes > 0 ? (capacity.availableBytes / capacity.totalBytes) * 100 : null;
  const findings: Array<{ severity: 'warning' | 'critical' | 'unknown'; message: string; disk?: number }> =
    [];
  if (freePercent === null) findings.push({ severity: 'unknown', message: '无法读取卷容量' });
  else if (
    freePercent < thresholds.minimumFreePercent ||
    capacity.availableBytes < thresholds.minimumFreeGiB * 1024 ** 3
  )
    findings.push({ severity: 'warning', message: '数据卷可用空间低于设置阈值' });
  /**
   * 入口 / Entry: evaluateDiskHealth.checkStatus.
   * 功能：在读取宿主卷容量并评估磁盘健康阈值中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`host-disk-health.ts`）。
   * Purpose: Checks admission, input or resource ownership in `host-disk-health.ts`; this entry produces `void` for its caller. Module context: Reads host volume capacity and evaluates health thresholds to provide evidence before maintenance.
   * 处理：通过 `findings.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `findings.push`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value === 'Healthy'`.
   * 输入 / Inputs: value: string; label: string; disk: number optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `findings.push`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const checkStatus = (value: string, label: string, disk?: number) => {
    if (value === 'Healthy') return;
    findings.push({
      severity: value === 'Unhealthy' ? 'critical' : value === 'Warning' ? 'warning' : 'unknown',
      message: `${label}健康状态：${value || '未知'}`,
      disk,
    });
  };
  if (observation.volume) checkStatus(observation.volume.health, '数据卷');
  else findings.push({ severity: 'unknown', message: observation.volumeError || '无法读取数据卷健康状态' });
  if (observation.volume?.operational.some((status) => status !== 'OK'))
    findings.push({
      severity: 'warning',
      message: '数据卷运行状态：' + observation.volume.operational.join('、'),
    });
  if (!observation.disks.length)
    findings.push({ severity: 'unknown', message: '无法把数据卷映射到磁盘，未推测物理设备' });
  for (const disk of observation.disks) {
    checkStatus(disk.health, '磁盘', disk.number);
    if (disk.operational.some((status) => !['Online', 'OK'].includes(status)))
      findings.push({
        severity: 'warning',
        disk: disk.number,
        message: '磁盘运行状态：' + disk.operational.join('、'),
      });
    const counters = disk.counters;
    if (!counters || Object.values(counters).every((value) => value === null))
      findings.push({
        severity: 'unknown',
        disk: disk.number,
        message: '可靠性计数器不可用：' + (disk.countersError || '设备未提供'),
      });
    if (counters) {
      if (
        Object.values(counters).some((value) => value === null) &&
        Object.values(counters).some((value) => value !== null)
      )
        findings.push({
          severity: 'unknown',
          disk: disk.number,
          message: '设备只提供部分可靠性计数器；空字段保持未知',
        });
      if (counters.temperatureC !== null && counters.temperatureC >= thresholds.maximumTemperatureC)
        findings.push({ severity: 'warning', disk: disk.number, message: '当前温度达到设置阈值' });
      if (counters.wearPercent !== null && counters.wearPercent >= thresholds.maximumWearPercent)
        findings.push({ severity: 'warning', disk: disk.number, message: '已消耗寿命百分比达到设置阈值' });
      if ((counters.readErrorsUncorrected || 0) > 0 || (counters.writeErrorsUncorrected || 0) > 0)
        findings.push({
          severity: 'warning',
          disk: disk.number,
          message: '设备记录了不可纠正的历史读写错误',
        });
    }
  }
  return {
    ...observation,
    capacity: { ...capacity, freePercent },
    thresholds,
    findings,
    status: findings.some((item) => item.severity === 'critical')
      ? 'critical'
      : findings.some((item) => item.severity === 'warning')
        ? 'warning'
        : findings.some((item) => item.severity === 'unknown')
          ? 'unknown'
          : 'healthy',
  };
}

/**
 * 入口 / Entry: hostDiskHealth.
 * 功能：在读取宿主卷容量并评估磁盘健康阈值中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ checkedAt: new Date().toISOString(), directory, provider: 'Windows Storage', ...evaluateDiskHealth( observation, { totalByt…` 供上层消费（`host-disk-health.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-disk-health.ts`; this entry produces `{ checkedAt: new Date().toISOString(), directory, provider: 'Windows Storage', ...evaluateDiskHealth( observation, { totalByt…` for its caller. Module context: Reads host volume capacity and evaluates health thresholds to provide evidence before maintenance.
 * 处理：通过 `diskHealthThresholds.parse`, `realpath`, `signal.throwIfAborted`, `access` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `diskHealthThresholds.parse`, `realpath`, `signal.throwIfAborted`, `access`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: input: unknown; signal: AbortSignal optional
 * 输出 / Returns: `{ checkedAt: new Date().toISOString(), directory, provider: 'Windows Storage', ...evaluateDiskHealth( observation, { totalByt…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function hostDiskHealth(input: unknown, signal?: AbortSignal) {
  const thresholds = diskHealthThresholds.parse(input),
    directory = await realpath(DATA);
  signal?.throwIfAborted();
  await access(directory, constants.R_OK);
  const capacity = await statfs(directory),
    observation = await windowsProbe(diskProbe, { directory }, signal);
  return {
    checkedAt: new Date().toISOString(),
    directory,
    provider: 'Windows Storage',
    ...evaluateDiskHealth(
      observation,
      { totalBytes: capacity.bsize * capacity.blocks, availableBytes: capacity.bsize * capacity.bavail },
      thresholds,
    ),
  };
}
