/**
 * 模块职责：采集并解析客户机指标，利用相邻网络采样计算速率并清理失效实例缓存。
 * Module purpose: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state.
 */
import { AppError } from '../shared/errors.ts';
type MetricsVm = {
/**
 * 签名 / Signature: MetricsVm.state.
 * 功能：为采集并解析客户机指标声明 state 的输入与结果契约，所属容器为 MetricsVm。
 * Purpose: Declares the input/result contract for state in MetricsVm. Module responsibility: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state.
 * 输入 / Inputs: id: string
 * 输出 / Returns: string.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
state(id: string): string;
/**
 * 签名 / Signature: MetricsVm.boot.
 * 功能：为采集并解析客户机指标声明 boot 的输入与结果契约，所属容器为 MetricsVm。
 * Purpose: Declares the input/result contract for boot in MetricsVm. Module responsibility: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state.
 * 输入 / Inputs: id: string
 * 输出 / Returns: string | undefined.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
boot?(id: string): string | undefined;
  live?: ReadonlyMap<string, { startedAt?: string }>;
  /**
   * 签名 / Signature: MetricsVm.exec.
   * 功能：为采集并解析客户机指标声明 exec 的输入与结果契约，所属容器为 MetricsVm。
   * Purpose: Declares the input/result contract for exec in MetricsVm. Module responsibility: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state.
   * 输入 / Inputs: id: string; command: string; timeout: number optional
   * 输出 / Returns: Promise<{ code: number; stdout: string; stderr: string }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  exec(id: string, command: string, timeout?: number): Promise<{ code: number; stdout: string; stderr: string }> };

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
/**
 * 入口 / Entry: parseMetrics.
 * 功能：在采集并解析客户机指标中，转换协议或持久数据表示并保持调用边界；本入口产生 `{ cpuPercent: total > 0 ? Math.max(0, Math.min(100, (100 * (total - idle)) / total)) : 0, memoryUsed, memoryTotal: mem.MemTot…` 供上层消费（`metrics.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `metrics.ts`; this entry produces `{ cpuPercent: total > 0 ? Math.max(0, Math.min(100, (100 * (total - idle)) / total)) : 0, memoryUsed, memoryTotal: mem.MemTot…` for its caller. Module context: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state.
 * 处理：通过 `section().trim().split().map`, `section().trim().split`, `section().trim`, `section` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `section().trim().split().map`, `section().trim().split`, `section().trim`, `section`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `{ cpuPercent: total > 0 ? Math.max(0, Math.min(100, (100 * (total - idle)) / total)) : 0, memoryUsed, memoryTotal: mem.MemTot…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `cpu.length !== 2 || cpu.some((row) => row.length !== 8 || row.some((n) => !Number.isFinite(n)))`; `![memoryUsed, mem.MemTotal, diskUsed, diskTotal].every((value) => Number.isFinite(value) && value >= 0) || !mem.MemTotal || !…`; 异常 / errors `new AppError('无法解析 CPU 采样')`; `new AppError('无法解析内存或磁盘采样')`.
 */
export function parseMetrics(text: string) {
  /**
   * 入口 / Entry: parseMetrics.section.
   * 功能：在采集并解析客户机指标中，执行此领域的具体处理步骤并返回其结果；本入口产生 `text.split(name + '\n')[1]?.split(next + '\n')[0] || ''` 供上层消费（`metrics.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `metrics.ts`; this entry produces `text.split(name + '\n')[1]?.split(next + '\n')[0] || ''` for its caller. Module context: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state.
   * 处理：通过 `text.split()[...].split`, `text.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `text.split()[...].split`, `text.split`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: name: string; next: string
   * 输出 / Returns: `text.split(name + '\n')[1]?.split(next + '\n')[0] || ''`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: parseMetrics.callback@45.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（networkText.split().flatMap）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (networkText.split().flatMap).
   * 输入 / Inputs: line
   * 输出 / Returns: `[]`; `[{ name: match[1].trim(), receivedBytes: fields[0], transmittedBytes: fields[8] }]`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `fields.length !== 16 || fields.some((value) => !Number.isSafeInteger(value) || value < 0)`; 异常 / errors `new AppError('无法解析网络采样')`.
   */
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

/**
 * 入口 / Entry: networkRates.
 * 功能：在采集并解析客户机指标中，执行此领域的具体处理步骤并返回其结果；本入口产生 `current` 供上层消费（`metrics.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `metrics.ts`; this entry produces `current` for its caller. Module context: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state.
 * 处理：通过 `current.networkInterfaces.map().sort().join`, `current.networkInterfaces.map().sort`, `current.networkInterfaces.map`, `previous.networkInterfaces.map().sort().join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `current.networkInterfaces.map().sort().join`, `current.networkInterfaces.map().sort`, `current.networkInterfaces.map`, `previous.networkInterfaces.map().sort().join`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!Number.isFinite(seconds) || seconds <= 0 || seconds > 120 || !sameInterfaces`; `current.networkInterfaces.some((item) => { const old = previous!.networkInterfaces.find((value) => v…`; `current.networkReceivedBytes !== null && previous!.networkReceivedBytes !== null`.
 * 输入 / Inputs: current: ReturnType<typeof parseMetrics>; previous: ReturnType<typeof parseMetrics> optional
 * 输出 / Returns: `current`.
 * 副作用 / Effects: 更新 / updates `current.networkReceiveBytesPerSecond`, `current.networkTransmitBytesPerSecond`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
  /**
   * 入口 / Entry: Metrics.constructor.
   * 功能：建立 Metrics 的采集并解析客户机指标上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Metrics context for this module's responsibility: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: vm: MetricsVm
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private vm: MetricsVm) {}
  /**
   * 入口 / Entry: Metrics.forget.
   * 功能：在采集并解析客户机指标中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Metrics`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Metrics`; the calls and state transitions below complete the operation. Module context: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state.
   * 处理：通过 `this.samples.delete`, `this.last.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.samples.delete`, `this.last.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.samples.delete`; `this.last.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  forget(id: string) {
    this.samples.delete(id);
    this.last.delete(id);
  }
  /**
   * 入口 / Entry: Metrics.close.
   * 功能：在采集并解析客户机指标中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`Metrics`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Metrics`; the calls and state transitions below complete the operation. Module context: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state.
   * 处理：通过 `Promise.allSettled`, `inline.map`, `this.samples.values`, `this.samples.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.allSettled`, `inline.map`, `this.samples.values`, `this.samples.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.samples.clear`; `this.last.clear`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    await Promise.allSettled([...this.samples.values()].map((item) => item.promise));
    this.samples.clear();
    this.last.clear();
  }
  /**
   * 入口 / Entry: Metrics.sample.
   * 功能：在采集并解析客户机指标中，执行此领域的具体处理步骤并返回其结果；本入口产生 `previous.promise` / `promise` 供上层消费（`Metrics`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Metrics`; this entry produces `previous.promise` / `promise` for its caller. Module context: Captures/parses guest metrics and computes network rates from successive samples, removing obsolete VM cache state.
   * 处理：通过 `this.vm.state`, `this.samples.get`, `this.vm.boot`, `this.vm.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.vm.state`, `this.samples.get`, `this.vm.boot`, `this.vm.live.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `previous && previous.boot === boot && Date.now() - previous.at < 3000`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `previous.promise`; `promise`.
   * 副作用 / Effects: `this.vm.exec().then().catch`; `this.vm.exec().then`; `this.vm.exec`; `this.samples.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.vm.state(id) !== 'running'`; 异常 / errors `new AppError('请先启动发行版', 409)`.
   */
  sample(id: string) {
    if (this.vm.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    const previous = this.samples.get(id);
    const boot = this.vm.boot ? this.vm.boot(id) : this.vm.live?.get(id)?.startedAt;
    if (previous && previous.boot === boot && Date.now() - previous.at < 3000) return previous.promise;
    /**
     * 入口 / Entry: Metrics.sample.callback@145.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.vm.exec().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.vm.exec().then).
     * 输入 / Inputs: result
     * 输出 / Returns: `point`.
     * 副作用 / Effects: `this.last.set`.
     * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('客户机采样失败', 502)`.
     */
    const promise = this.vm
      .exec(id, metricsScript, 10000)
      .then((result) => {
        if (result.code !== 0) throw new AppError('客户机采样失败', 502);
        const old = this.last.get(id),
          point = networkRates(parseMetrics(result.stdout), old && old.boot === boot ? old.point : undefined);
        if (this.samples.get(id)?.promise === promise && (this.vm.boot ? this.vm.boot(id) : this.vm.live?.get(id)?.startedAt) === boot)
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
