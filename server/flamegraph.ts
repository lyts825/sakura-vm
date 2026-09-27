import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';

export const flamegraphOptions = z.object({
  durationSeconds: z.number().int().min(1).max(10).default(5),
  frequencyHz: z.number().int().min(10).max(99).default(49),
}).strict();

type Frame = { name: string; count: number; children: Map<string, Frame> };
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);

function color(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${(hash % 45) + 10} 84% ${56 + hash % 15}%)`;
}

export function renderFlamegraph(script: string) {
  const root: Frame = { name: '全部采样', count: 0, children: new Map() };
  const top = new Map<string, number>();
  let processName = '';
  let frames: string[] = [];
  let samples = 0;
  let clipped = false;
  let maxDepth = 0;
  const add = () => {
    if (!processName || !frames.length || samples >= 2000) return;
    samples += 1;
    root.count += 1;
    let node = root;
    const stack = [processName, ...frames.reverse()].slice(0, 33);
    maxDepth = Math.max(maxDepth, stack.length);
    for (const name of stack) {
      let child = node.children.get(name);
      if (!child) {
        child = { name, count: 0, children: new Map() };
        node.children.set(name, child);
      }
      child.count += 1;
      node = child;
    }
    for (const name of stack.slice(1)) top.set(name, (top.get(name) || 0) + 1);
  };
  for (const line of script.split(/\r?\n/)) {
    if (samples >= 2000) { clipped = true; break; }
    const header = /^\s*(.*?)\s+\d+(?:\/\d+)?\s+\[\d+\]\s+[\d.]+:/.exec(line);
    if (header) {
      add();
      processName = header[1].trim().slice(0, 100) || '未知进程';
      frames = [];
      continue;
    }
    if (!line.trim()) {
      add();
      processName = '';
      frames = [];
      continue;
    }
    const frame = /^\s+[0-9a-fA-F]+\s+(.+?)(?:\s+\([^()]*\))?\s*$/.exec(line);
    if (frame && processName && frames.length < 32) {
      const name = frame[1].replace(/\+0x[\da-fA-F]+(?:\/[\da-fA-F]+)?$/, '').trim();
      frames.push((name || '[未知符号]').slice(0, 100));
    }
  }
  add();
  if (!samples) throw new AppError('性能采样没有返回调用栈；请确认 perf 权限并让实例运行实际工作负载', 409);

  const width = 1200;
  const left = 12;
  const chartWidth = width - 24;
  const row = 23;
  const height = 78 + maxDepth * row;
  const shapes: string[] = [];
  const draw = (node: Frame, x: number, depth: number) => {
    if (shapes.length >= 6000) { clipped = true; return; }
    const rectWidth = chartWidth * node.count / samples;
    if (rectWidth < 0.5) return;
    const y = height - 24 - (depth + 1) * row;
    const label = escapeXml(node.name);
    const pct = (node.count / samples * 100).toFixed(1);
    shapes.push(`<g><title>${label}: ${node.count} 次 (${pct}%)</title><rect x="${x.toFixed(2)}" y="${y}" width="${rectWidth.toFixed(2)}" height="21" rx="2" fill="${color(node.name)}" stroke="#fff" stroke-width="0.5"/><text x="${(x + 4).toFixed(2)}" y="${y + 15}" clip-path="url(#clip-${shapes.length})">${label}</text><clipPath id="clip-${shapes.length}"><rect x="${(x + 3).toFixed(2)}" y="${y}" width="${Math.max(0, rectWidth - 6).toFixed(2)}" height="21"/></clipPath></g>`);
    let nextX = x;
    for (const child of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      draw(child, nextX, depth + 1);
      nextX += chartWidth * child.count / samples;
    }
  };
  let x = left;
  for (const child of [...root.children.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    draw(child, x, 0);
    x += chartWidth * child.count / samples;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Sakura 性能火焰图"><rect width="100%" height="100%" fill="#fff"/><style>text{font:12px sans-serif;fill:#241a1a;pointer-events:none}</style><text x="12" y="27" style="font:bold 18px sans-serif">Sakura 性能火焰图</text><text x="12" y="49">${samples} 次采样 · 横向宽度表示采样占比 · 自下而上为调用栈</text>${shapes.join('')}</svg>`;
  return { svg, samples, clipped, frameCount: shapes.length,
    topFrames: [...top].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })) };
}

export async function checkFlamegraph(machines: Machines, id: string, signal?: AbortSignal) {
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, reason: '请先启动实例。' };
  try {
    const result = await machines.exec(id, 'command -v perf >/dev/null 2>&1 && perf version', 10000, signal);
    return { ready: result.code === 0, executed: false,
      reason: result.code === 0 ? '已找到 perf；采样权限将在执行时检查。' : '客户机未安装 perf。',
      version: result.stdout.trim().slice(0, 200) };
  } catch (error) {
    signal?.throwIfAborted();
    return { ready: false, executed: false, reason: (error as Error).message };
  }
}

export async function runFlamegraph(machines: Machines, id: string, input: unknown, signal: AbortSignal) {
  const options = flamegraphOptions.parse(input);
  if (machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
  signal.throwIfAborted();
  const command = `set -eu
command -v perf >/dev/null 2>&1 || { echo '客户机未安装 perf' >&2; exit 127; }
sample_dir=$(mktemp -d /tmp/sakura-perf.XXXXXX)
trap 'rm -rf "$sample_dir"' EXIT HUP INT TERM
perf record -q -F ${options.frequencyHz} -g -a -o "$sample_dir/perf.data" -- sleep ${options.durationSeconds}
perf script -i "$sample_dir/perf.data" > "$sample_dir/trace"
head -c 750000 "$sample_dir/trace"`;
  const response = await machines.exec(id, command, (options.durationSeconds + 30) * 1000, signal);
  if (response.code !== 0)
    throw new AppError(`性能采样失败：${(response.stderr || response.stdout || `退出码 ${response.code}`).trim().slice(0, 500)}`, 409);
  const graph = renderFlamegraph(response.stdout);
  const { svg, ...summary } = graph;
  return { code: 0, ready: true, executed: true, ...options, ...summary,
    clipped: summary.clipped || response.stdout.length >= 750000,
    download: { filename: 'sakura-flamegraph.svg', mime: 'image/svg+xml', content: svg } };
}
