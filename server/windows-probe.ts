/**
 * 模块职责：执行 Windows 宿主只读探测并解析 JSON，区分平台不支持与无效输出。
 */
import { hostExecFile } from './host-process.ts';
import { join } from 'node:path';
import { AppError } from '../shared/errors.ts';

/** Internal fixed scripts only. Input is JSON on stdin, never shell source. */
export async function windowsProbe(script: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
  if (process.platform !== 'win32') throw new AppError('此检查需要 Windows 宿主机', 409);
  signal?.throwIfAborted();
  const executable = join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const source =
    "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $request=[Console]::In.ReadToEnd() | ConvertFrom-Json;\n" +
    script;
  try {
    const { stdout } = await hostExecFile(
      'windows-probe',
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(source, 'utf16le').toString('base64'),
      ],
      {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        signal,
        input: JSON.stringify(input),
      },
    );
    try {
      return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    } catch {
      throw new AppError('Windows 查询没有返回有效 JSON', 502);
    }
  } catch (error) {
    if (error instanceof AppError && error.status === 503) throw error;
    if (signal?.aborted) throw signal.reason;
    throw error;
  }
}
