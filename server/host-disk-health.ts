import { access, realpath, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { z } from 'zod';
import { DATA } from './model.ts';
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
