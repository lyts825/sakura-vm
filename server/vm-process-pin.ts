/** 从本体独占的 QEMU 运行回执固定宿主进程身份，不按名称选择进程。
 * Pin a host process from a core-owned QEMU run receipt, never by process name. */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { hostExecFile } from './host-process.ts';
import type { Live } from './vm-state.ts';
const pinSchema = z
  .object({
    pid: z.number().int().positive(),
    created: z.string().regex(/^\d{15,22}$/),
    path: z.string().min(1),
    startedAt: z.string(),
  })
  .strict();
export type WindowsProcessPin = z.infer<typeof pinSchema>;

/** 仅读取准确 PID 的创建时间与可执行文件，后续监管按打开的句柄再核验。
 * Read creation time and executable for an exact PID; the watchdog verifies its opened handle again. */
export async function windowsProcessPin(pid: number): Promise<WindowsProcessPin> {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid < 1)
    throw new AppError('当前宿主不支持已验证的 Windows 进程固定', 409, 'DRILL_PLATFORM_UNAVAILABLE');
  const script =
    `$ErrorActionPreference='Stop'; $taskProcess=Get-Process -Id ${pid}; ` +
    `[ordered]@{pid=$taskProcess.Id;created=$taskProcess.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();` +
    `path=$taskProcess.Path;startedAt=$taskProcess.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress`;
  const file = join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const result = await hostExecFile(
    'drill-probe',
    file,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { timeout: 10000, maxBuffer: 8192, lane: 'control' },
  );
  const pin = pinSchema.parse(JSON.parse(result.stdout));
  if (pin.pid !== pid) throw new AppError('进程身份返回不匹配', 409, 'DRILL_PROCESS_CHANGED');
  return pin;
}

/** 只通过原 PID 的句柄和 FILETIME 确认退出；无法查询时保留未知状态。
 * Prove original-process exit from a read-only handle and FILETIME; query failures remain unknown. */
export async function windowsOriginalProcessStopped(pid: number, created: string): Promise<boolean> {
  if (process.platform !== 'win32')
    throw new AppError('当前宿主不支持 Windows 原进程核验', 409, 'DRILL_PLATFORM_UNAVAILABLE');
  if (
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    pid > 0x7fffffff ||
    typeof created !== 'string' ||
    !/^[1-9]\d{14,18}$/.test(created) ||
    BigInt(created) > 0x7fffffffffffffffn
  )
    throw new AppError('原进程 PID 或创建时间无效', 400, 'DRILL_PROCESS_IDENTITY_INVALID');
  const source = `using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class SakuraOriginalProcessProbe {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  public static bool Stopped(int pid, long expectedCreated) {
    // QUERY_LIMITED_INFORMATION and SYNCHRONIZE only: never request termination rights.
    IntPtr handle = OpenProcess(0x1000 | 0x00100000, false, pid);
    if (handle == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      if (error == 87) return true; // Valid nonzero PID no longer exists.
      throw new Win32Exception(error, "original-process-open");
    }
    try {
      long actualCreated, exited, kernel, user;
      if (!GetProcessTimes(handle, out actualCreated, out exited, out kernel, out user))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "original-process-times");
      if (actualCreated != expectedCreated) return true;
      uint state = WaitForSingleObject(handle, 0);
      if (state == 0) return true;
      if (state == 258) return false;
      throw new Win32Exception(Marshal.GetLastWin32Error(), "original-process-wait:" + state);
    } finally {
      if (!CloseHandle(handle)) throw new Win32Exception(Marshal.GetLastWin32Error(), "original-process-handle-close");
    }
  }
}`;
  const script =
    `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'\n${source}\n'@;\n` +
    `[ordered]@{pid=${pid};created='${created}';stopped=[SakuraOriginalProcessProbe]::Stopped(${pid},[long]'${created}')}|ConvertTo-Json -Compress`;
  const result = await hostExecFile(
    'drill-probe',
    join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { timeout: 10000, maxBuffer: 8192, lane: 'control' },
  );
  const proof = z
    .object({ pid: z.number().int().positive(), created: z.string(), stopped: z.boolean() })
    .strict()
    .parse(JSON.parse(result.stdout));
  if (proof.pid !== pid || proof.created !== created)
    throw new AppError('原进程退出核验返回不匹配', 409, 'DRILL_PROCESS_CHANGED');
  return proof.stopped;
}

/** 随机运行文件、实际启动参数及进程创建时间共同固定当前 QEMU。
 * Bind the random run file, actual argv, and creation time to this QEMU run. */
export async function qemuProcessPin(live: Live): Promise<WindowsProcessPin> {
  if (!live.processRecordFile || !live.processArguments || live.abort.signal.aborted)
    throw new AppError('原实例缺少进程回执', 409, 'DRILL_PROCESS_UNAVAILABLE');
  const file = live.processRecordFile,
    before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 32)
    throw new AppError('运行进程回执不是独占普通文件', 409, 'DRILL_PROCESS_CHANGED');
  const value = (await readFile(file, 'utf8')).trim();
  if (!/^[1-9]\d{0,9}$/.test(value)) throw new AppError('运行 PID 回执无效', 409, 'DRILL_PROCESS_CHANGED');
  const pin = await windowsProcessPin(Number(value)),
    after = await lstat(file);
  const started = Date.parse(pin.startedAt);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs ||
    before.size !== after.size ||
    !Number.isFinite(started) ||
    started < Date.parse(live.startedAt) - 1000 ||
    !/(?:^|[\\/])qemu-system-(?:x86_64|aarch64)\.exe$/i.test(pin.path) ||
    live.abort.signal.aborted
  )
    throw new AppError('QEMU 进程与原启动回执不符', 409, 'DRILL_PROCESS_CHANGED');
  return pin;
}
