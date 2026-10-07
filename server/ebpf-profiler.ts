/**
 * 模块职责：检查客户机 eBPF 工具并解析内核调用栈采样，缺少有效采样时拒绝伪造结果。
 * Module purpose: Checks guest eBPF tooling and parses kernel stack samples, refusing to synthesize results when sampling is unavailable.
 */
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';

export const ebpfProfileOptions = z.object({
  durationSeconds: z.number().int().min(1).max(10).default(5),
  frequencyHz: z.number().int().min(10).max(99).default(49),
}).strict();

/**
 * 入口 / Entry: parseKernelProfile.
 * 功能：在检查客户机 eBPF 工具并解析内核调用栈采样中，转换协议或持久数据表示并保持调用边界；本入口产生 `{ samples, stackCount: stacks.length, clipped, stacks, topSymbols: [...symbols].sort((a, b) => b[1] - a[1]).slice(0, 20) .map…` 供上层消费（`ebpf-profiler.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `ebpf-profiler.ts`; this entry produces `{ samples, stackCount: stacks.length, clipped, stacks, topSymbols: [...symbols].sort((a, b) => b[1] - a[1]).slice(0, 20) .map…` for its caller. Module context: Checks guest eBPF tooling and parses kernel stack samples, refusing to synthesize results when sampling is unavailable.
 * 处理：通过 `output.matchAll`, `match[...].split().map().filter().slice().map`, `match[...].split().map().filter().slice`, `match[...].split().map().filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `output.matchAll`, `match[...].split().map().filter().slice().map`, `match[...].split().map().filter().slice`, `match[...].split().map().filter`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `stacks.length >= 500`; `!Number.isSafeInteger(count) || count < 1`; `!frames.length`.
 * 输入 / Inputs: output: string
 * 输出 / Returns: `{ samples, stackCount: stacks.length, clipped, stacks, topSymbols: [...symbols].sort((a, b) => b[1] - a[1]).slice(0, 20) .map…`.
 * 副作用 / Effects: `stacks.push`; `symbols.set`; 更新 / updates `clipped`, `samples`.
 * 拒绝 / Refusals: 条件 / conditions `!samples`; 异常 / errors `new AppError('eBPF 采样没有返回内核调用栈；请检查客户机内核、权限和工作负载', 409)`.
 */
export function parseKernelProfile(output: string) {
  const stacks: Array<{ frames: string[]; count: number }> = [];
  const symbols = new Map<string, number>();
  let samples = 0;
  let clipped = false;
  for (const match of output.matchAll(/@\[\s*\n([\s\S]*?)\n\s*\]:\s*(\d+)/g)) {
    if (stacks.length >= 500) { clipped = true; break; }
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count) || count < 1) continue;
    const frames = match[1].split(/\r?\n/).map((value) => value.trim())
      .filter(Boolean).slice(0, 32).map((value) =>
        value.replace(/\+(?:0x[\da-fA-F]+|\d+)(?:\s+.*)?$/, '').slice(0, 100));
    if (!frames.length) continue;
    stacks.push({ frames, count });
    samples += count;
    for (const symbol of new Set(frames)) symbols.set(symbol, (symbols.get(symbol) || 0) + count);
  }
  if (!samples) throw new AppError('eBPF 采样没有返回内核调用栈；请检查客户机内核、权限和工作负载', 409);
  stacks.sort((a, b) => b.count - a.count);
  return { samples, stackCount: stacks.length, clipped, stacks,
    topSymbols: [...symbols].sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([name, count]) => ({ name, count, percent: Number((count / samples * 100).toFixed(1)) })) };
}

/**
 * 入口 / Entry: checkEbpfProfiler.
 * 功能：在检查客户机 eBPF 工具并解析内核调用栈采样中，核对调用资格、输入或资源归属；本入口产生 `{ ready: false, executed: false, reason: '请先启动实例。' }` / `{ ready: result.code === 0, executed: false, reason: result.code === 0 ? '已找到 bpftrace；内核和权限将在执行时验证。' : '客户机未安装 bpftrace。', v…` 供上层消费（`ebpf-profiler.ts`）。
 * Purpose: Checks admission, input or resource ownership in `ebpf-profiler.ts`; this entry produces `{ ready: false, executed: false, reason: '请先启动实例。' }` / `{ ready: result.code === 0, executed: false, reason: result.code === 0 ? '已找到 bpftrace；内核和权限将在执行时验证。' : '客户机未安装 bpftrace。', v…` for its caller. Module context: Checks guest eBPF tooling and parses kernel stack samples, refusing to synthesize results when sampling is unavailable.
 * 处理：通过 `machines.state`, `machines.exec`, `result.stdout.trim().slice`, `result.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.state`, `machines.exec`, `result.stdout.trim().slice`, `result.stdout.trim`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `machines.state(id) !== 'running'`.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, reason: '请先启动实例。' }`; `{ ready: result.code === 0, executed: false, reason: result.code === 0 ? '已找到 bpftrace；内核和权限将在执行时验证。' : '客户机未安装 bpftrace。', v…`; `{ ready: false, executed: false, reason: (error as Error).message }`.
 * 副作用 / Effects: `machines.exec`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `signal?.throwIfAborted();`; `return { ready: false, executed: false, reason: (error as Error).message };`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `signal?.throwIfAborted();`; `return { ready: false, executed: false, reason: (error as Error).message };`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function checkEbpfProfiler(machines: Machines, id: string, signal?: AbortSignal) {
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, reason: '请先启动实例。' };
  try {
    const result = await machines.exec(id,
      'command -v bpftrace >/dev/null 2>&1 && bpftrace --version', 10000, signal);
    return { ready: result.code === 0, executed: false,
      reason: result.code === 0 ? '已找到 bpftrace；内核和权限将在执行时验证。' : '客户机未安装 bpftrace。',
      version: result.stdout.trim().slice(0, 200) };
  } catch (error) {
    signal?.throwIfAborted();
    return { ready: false, executed: false, reason: (error as Error).message };
  }
}

/**
 * 入口 / Entry: runEbpfProfiler.
 * 功能：在检查客户机 eBPF 工具并解析内核调用栈采样中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ code: 0, ready: true, executed: true, ...options, samples: report.samples, stackCount: report.stackCount, clipped, topSymbo…` 供上层消费（`ebpf-profiler.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ebpf-profiler.ts`; this entry produces `{ code: 0, ready: true, executed: true, ...options, samples: report.samples, stackCount: report.stackCount, clipped, topSymbo…` for its caller. Module context: Checks guest eBPF tooling and parses kernel stack samples, refusing to synthesize results when sampling is unavailable.
 * 处理：通过 `ebpfProfileOptions.parse`, `machines.state`, `signal.throwIfAborted`, `machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `ebpfProfileOptions.parse`, `machines.state`, `signal.throwIfAborted`, `machines.exec`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; id: string; input: unknown; signal: AbortSignal
 * 输出 / Returns: `{ code: 0, ready: true, executed: true, ...options, samples: report.samples, stackCount: report.stackCount, clipped, topSymbo…`.
 * 副作用 / Effects: `machines.exec`.
 * 拒绝 / Refusals: 条件 / conditions `machines.state(id) !== 'running'`; `response.code !== 0`; 异常 / errors `new AppError('请先启动实例', 409)`; `new AppError(`eBPF 采样失败：${(response.stderr || response.stdout || `退出码 ${response.code}`).trim().slice(0, 500)}`, 409)`.
 */
export async function runEbpfProfiler(machines: Machines, id: string, input: unknown,
  signal: AbortSignal) {
  const options = ebpfProfileOptions.parse(input);
  if (machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
  signal.throwIfAborted();
  const program = `profile:hz:${options.frequencyHz} { @[kstack(32)] = count(); } interval:s:${options.durationSeconds} { exit(); }`;
  const command = `set -eu
command -v bpftrace >/dev/null 2>&1 || { echo '客户机未安装 bpftrace' >&2; exit 127; }
sample_dir=$(mktemp -d /tmp/sakura-ebpf.XXXXXX)
pid=
cleanup() { if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || :; wait "$pid" 2>/dev/null || :; fi; rm -rf "$sample_dir"; }
trap cleanup EXIT HUP INT TERM
bpftrace -q -e '${program}' > "$sample_dir/profile" 2> "$sample_dir/error" &
pid=$!
if ! wait "$pid"; then cat "$sample_dir/error" >&2; exit 1; fi
pid=
head -c 750000 "$sample_dir/profile"`;
  const response = await machines.exec(id, command, (options.durationSeconds + 30) * 1000, signal);
  if (response.code !== 0)
    throw new AppError(`eBPF 采样失败：${(response.stderr || response.stdout || `退出码 ${response.code}`).trim().slice(0, 500)}`, 409);
  const profile = parseKernelProfile(response.stdout);
  const clipped = profile.clipped || response.stdout.length >= 750000;
  const report = { ...options, ...profile, clipped };
  return { code: 0, ready: true, executed: true, ...options, samples: report.samples,
    stackCount: report.stackCount, clipped, topSymbols: report.topSymbols,
    download: { filename: 'sakura-ebpf-kernel-profile.json', mime: 'application/json',
      content: JSON.stringify(report, null, 2) } };
}
