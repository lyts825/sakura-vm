import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';

export const ebpfProfileOptions = z.object({
  durationSeconds: z.number().int().min(1).max(10).default(5),
  frequencyHz: z.number().int().min(10).max(99).default(49),
}).strict();

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
