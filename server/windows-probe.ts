/**
 * 模块职责：执行 Windows 宿主只读探测并解析 JSON，区分平台不支持与无效输出。
 * Module purpose: Runs read-only Windows probes and parses JSON, distinguishing platform refusal from invalid tool output.
 */
import { hostExecFile } from './host-process.ts';
import { join } from 'node:path';
import { AppError } from '../shared/errors.ts';

/** Internal fixed scripts only. Input is JSON on stdin, never shell source. */
/**
 * 入口 / Entry: windowsProbe.
 * 功能：在执行 Windows 宿主只读探测并解析 JSON中，执行此领域的具体处理步骤并返回其结果；本入口产生 `JSON.parse(stdout.replace(/^\uFEFF/, '').trim())` 供上层消费（`windows-probe.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `windows-probe.ts`; this entry produces `JSON.parse(stdout.replace(/^\uFEFF/, '').trim())` for its caller. Module context: Runs read-only Windows probes and parses JSON, distinguishing platform refusal from invalid tool output.
 * 处理：通过 `signal.throwIfAborted`, `join`, `hostExecFile`, `stdout.replace().trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `join`, `hostExecFile`, `stdout.replace().trim`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: script: string; input: unknown; signal: AbortSignal optional
 * 输出 / Returns: Promise<unknown>；结果来自 / values from `JSON.parse(stdout.replace(/^\uFEFF/, '').trim())`.
 * 副作用 / Effects: `stdout.replace().trim`; `stdout.replace`.
 * 拒绝 / Refusals: 条件 / conditions `process.platform !== 'win32'`; `error instanceof AppError && error.status === 503`; `signal?.aborted`; 异常 / errors `new AppError('此检查需要 Windows 宿主机', 409)`; `new AppError('Windows 查询没有返回有效 JSON', 502)`.
 * 失败处理：catch 分支执行 `if (error instanceof AppError && error.status === 503) throw error;`; `if (signal?.aborted) throw signal.reason;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (error instanceof AppError && error.status === 503) throw error;`; `if (signal?.aborted) throw signal.reason;`; these statements determine whether a failure is absorbed or rejected again.
 */
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
