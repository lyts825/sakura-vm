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
echo NETWORK
cat /proc/net/dev
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
  const disk = section('DISK', text.includes('\nNETWORK\n') ? 'NETWORK' : 'PROCESSES')
    .trim()
    .split(/\s+/);
  const networkText = section('NETWORK', 'PROCESSES');
  const interfaces = networkText.split('\n').flatMap((line) => {
    const match = line.match(/^\s*([^:]+):\s*(.+)$/);
    if (!match || match[1].trim() === 'lo') return [];
    const fields = match[2].trim().split(/\s+/).map(Number);
    if (fields.length !== 16 || fields.some((value) => !Number.isSafeInteger(value) || value < 0))
      throw new AppError('无法解析网络采样');
    return [{ name: match[1].trim(), receivedBytes: fields[0], transmittedBytes: fields[8] }];
  });
  const memoryUsed = mem.MemTotal - (mem.MemAvailable ?? mem.MemFree),
    diskUsed = Number(disk[2]) * 1024,
    diskTotal = Number(disk[1]) * 1024;
  if (
    ![memoryUsed, mem.MemTotal, diskUsed, diskTotal].every((value) => Number.isFinite(value) && value >= 0) ||
    !mem.MemTotal ||
    !diskTotal
  )
    throw new AppError('无法解析内存或磁盘采样');
  return {
    cpuPercent: total > 0 ? Math.max(0, Math.min(100, (100 * (total - idle)) / total)) : 0,
    memoryUsed,
    memoryTotal: mem.MemTotal,
    diskUsed,
    diskTotal,
    networkReceivedBytes: networkText ? interfaces.reduce((sum, item) => sum + item.receivedBytes, 0) : null,
    networkTransmittedBytes: networkText
      ? interfaces.reduce((sum, item) => sum + item.transmittedBytes, 0)
      : null,
    networkInterfaces: interfaces,
    networkReceiveBytesPerSecond: null as number | null,
    networkTransmitBytesPerSecond: null as number | null,
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

export function networkRates(
  current: ReturnType<typeof parseMetrics>,
  previous?: ReturnType<typeof parseMetrics>,
) {
  const seconds = previous ? current.uptime - previous.uptime : 0;
  const sameInterfaces =
    previous &&
    current.networkInterfaces
      .map((item) => item.name)
      .sort()
      .join(',') ===
      previous.networkInterfaces
        .map((item) => item.name)
        .sort()
        .join(',');
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120 || !sameInterfaces) return current;
  // A reboot, interface replacement or counter reset must not turn into a traffic spike.
  if (
    current.networkInterfaces.some((item) => {
      const old = previous!.networkInterfaces.find((value) => value.name === item.name)!;
      return item.receivedBytes < old.receivedBytes || item.transmittedBytes < old.transmittedBytes;
    })
  )
    return current;
  if (current.networkReceivedBytes !== null && previous!.networkReceivedBytes !== null)
    current.networkReceiveBytesPerSecond =
      (current.networkReceivedBytes - previous!.networkReceivedBytes) / seconds;
  if (current.networkTransmittedBytes !== null && previous!.networkTransmittedBytes !== null)
    current.networkTransmitBytesPerSecond =
      (current.networkTransmittedBytes - previous!.networkTransmittedBytes) / seconds;
  return current;
}

/** On-demand sampling; no project setup, jobs or polling timer. */
export class Metrics {
  private last = new Map<string, { boot: string | undefined; point: ReturnType<typeof parseMetrics> }>();
  private samples = new Map<
    string,
    { at: number; boot: string | undefined; promise: Promise<ReturnType<typeof parseMetrics>> }
  >();
  constructor(private machines: Machines) {}
  forget(id: string) {
    this.samples.delete(id);
    this.last.delete(id);
  }
  async close() {
    await Promise.allSettled([...this.samples.values()].map((item) => item.promise));
    this.samples.clear();
    this.last.clear();
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
        const old = this.last.get(id),
          point = networkRates(parseMetrics(result.stdout), old && old.boot === boot ? old.point : undefined);
        if (this.samples.get(id)?.promise === promise && this.machines.live.get(id)?.startedAt === boot)
          this.last.set(id, { boot, point });
        return point;
      })
      .catch((error) => {
        if (this.samples.get(id)?.promise === promise) this.samples.delete(id);
        throw error;
      });
    this.samples.set(id, { at: Date.now(), boot, promise });
    return promise;
  }
}
