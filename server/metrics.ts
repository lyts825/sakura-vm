import { AppError } from './model.ts';
import type { Machines } from './machines.ts';

export const metricsScript = String.raw`set -eu
echo CPU
head -n 1 /proc/stat
sleep 0.25
head -n 1 /proc/stat
echo MEMORY
cat /proc/meminfo
echo DISK
df -Pk / | tail -n 1
echo PROCESSES
for p in /proc/[0-9]*; do
  [ -r "$p/status" ] || continue
  awk '/^Name:/ {n=$2} /^VmRSS:/ {m=$2} END {if(m) print m, n}' "$p/status" 2>/dev/null || true
done | sort -nr | head -n 8
echo UPTIME
cat /proc/uptime`;
export function parseMetrics(text: string) {
  const section = (name: string, next: string) => text.split(name + '\n')[1]?.split(next + '\n')[0] || '';
  const cpu = section('CPU', 'MEMORY')
    .trim()
    .split('\n')
    .map((s) => s.trim().split(/\s+/).slice(1, 9).map(Number));
  if (cpu.length !== 2 || cpu.some((row) => row.length !== 8 || row.some((n) => !Number.isFinite(n))))
    throw new AppError('无法解析 CPU 采样');
  const totals = cpu.map((row) => row.reduce((a, b) => a + b, 0));
  const total = totals[1] - totals[0],
    idle = cpu[1][3] + cpu[1][4] - cpu[0][3] - cpu[0][4];
  const mem = Object.fromEntries(
    [...section('MEMORY', 'DISK').matchAll(/^(\w+):\s+(\d+)/gm)].map((m) => [m[1], Number(m[2]) * 1024]),
  );
  const disk = section('DISK', 'PROCESSES').trim().split(/\s+/);
  return {
    cpuPercent: total > 0 ? Math.max(0, Math.min(100, (100 * (total - idle)) / total)) : 0,
    memoryUsed: mem.MemTotal - (mem.MemAvailable ?? mem.MemFree),
    memoryTotal: mem.MemTotal,
    diskUsed: Number(disk[2]) * 1024,
    diskTotal: Number(disk[1]) * 1024,
    processes: section('PROCESSES', 'UPTIME')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((s) => {
        const [rss, ...name] = s.trim().split(/\s+/);
        return { name: name.join(' '), memory: Number(rss) * 1024 };
      }),
    uptime: Number(text.split('UPTIME\n')[1]?.trim().split(' ')[0]),
    sampledAt: new Date().toISOString(),
  };
}

/** On-demand sampling; no project setup, jobs or polling timer. */
export class Metrics {
  private samples = new Map<
    string,
    { at: number; boot: string | undefined; promise: Promise<ReturnType<typeof parseMetrics>> }
  >();
  constructor(private machines: Machines) {}
  forget(id: string) {
    this.samples.delete(id);
  }
  async close() {
    await Promise.allSettled([...this.samples.values()].map((item) => item.promise));
    this.samples.clear();
  }
  sample(id: string) {
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    const previous = this.samples.get(id);
    const boot = this.machines.live.get(id)?.startedAt;
    if (previous && previous.boot === boot && Date.now() - previous.at < 3000) return previous.promise;
    const promise = this.machines
      .exec(id, metricsScript, 10000)
      .then((result) => {
        if (result.code !== 0) throw new AppError('客户机采样失败', 502);
        return parseMetrics(result.stdout);
      })
      .catch((error) => {
        if (this.samples.get(id)?.promise === promise) this.samples.delete(id);
        throw error;
      });
    this.samples.set(id, { at: Date.now(), boot, promise });
    return promise;
  }
}
