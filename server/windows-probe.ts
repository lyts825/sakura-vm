import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { AppError } from './model.ts';

/** Internal fixed scripts only. Input is JSON on stdin, never shell source. */
export function windowsProbe(script: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
  if (process.platform !== 'win32') throw new AppError('此检查需要 Windows 宿主机', 409);
  signal?.throwIfAborted();
  const executable = join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const source =
    "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $request=[Console]::In.ReadToEnd() | ConvertFrom-Json;\n" +
    script;
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(source, 'utf16le').toString('base64'),
      ],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
        signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            signal?.aborted
              ? signal.reason
              : new AppError('Windows 查询失败或超时：' + stderr.trim().slice(0, 1000), 409),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim()));
        } catch {
          reject(new AppError('Windows 查询没有返回有效 JSON', 502));
        }
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(input));
  });
}
