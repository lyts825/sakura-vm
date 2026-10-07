/**
 * 模块职责：记录固定来源与阶段的运行耗时，提供可组合的测量和诊断快照。
 * Module purpose: Records timings for fixed sources/phases, exposing composable measurements and bounded diagnostic snapshots.
 */
export const TIMING_SOURCES = ['http', 'job', 'compute', 'resource'] as const;
export const TIMING_PHASES = [
  'queue',
  'execution',
  'cleanup',
  'response',
  'audit',
  'resource-lifetime',
] as const;
type Source = (typeof TIMING_SOURCES)[number];
type Phase = (typeof TIMING_PHASES)[number];
type Sample = { at: number; ms: number };

/** Fixed dimensions only. No VM, plugin, operation or user identities become metric labels. */
export class RuntimeTimings {
  readonly windowMs = 60_000;
  readonly maxSamples = 1024;
  private series = new Map<string, { source: Source; phase: Phase; samples: Sample[] }>();
  /**
   * 入口 / Entry: RuntimeTimings.constructor.
   * 功能：建立 RuntimeTimings 的记录固定来源与阶段的运行耗时上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the RuntimeTimings context for this module's responsibility: Records timings for fixed sources/phases, exposing composable measurements and bounded diagnostic snapshots. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: now: () => number default=() => performance.now()
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private now: () => number = () => performance.now()) {}
  /**
   * 入口 / Entry: RuntimeTimings.observe.
   * 功能：在记录固定来源与阶段的运行耗时中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`RuntimeTimings`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RuntimeTimings`; this entry produces `void` for its caller. Module context: Records timings for fixed sources/phases, exposing composable measurements and bounded diagnostic snapshots.
   * 处理：通过 `TIMING_SOURCES.includes`, `TIMING_PHASES.includes`, `this.series.get`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `TIMING_SOURCES.includes`, `TIMING_PHASES.includes`, `this.series.get`, `this.now`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!TIMING_SOURCES.includes(source) || !TIMING_PHASES.includes(phase) || !Number.isFinite(ms) || ms < 0`; `entry.samples.length > this.maxSamples`.
   * 输入 / Inputs: source: Source; phase: Phase; ms: number
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `entry.samples.push`; `entry.samples.shift`; `this.series.set`; 更新 / updates `entry.samples`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  observe(source: Source, phase: Phase, ms: number) {
    if (!TIMING_SOURCES.includes(source) || !TIMING_PHASES.includes(phase) || !Number.isFinite(ms) || ms < 0)
      return;
    const key = source + ':' + phase,
      entry = this.series.get(key) || { source, phase, samples: [] };
    const at = this.now();
    entry.samples = entry.samples.filter((sample) => at - sample.at <= this.windowMs);
    entry.samples.push({ at, ms });
    if (entry.samples.length > this.maxSamples) entry.samples.shift();
    this.series.set(key, entry);
  }
  /**
   * 入口 / Entry: RuntimeTimings.start.
   * 功能：从当前输入或状态计算 `() => { if (!ended) { ended = true; this.observe(source, phase, Math.max(0, this.now() - began)); } }`，供调用方后续验证或使用。
   * Purpose: Computes `() => { if (!ended) { ended = true; this.observe(source, phase, Math.max(0, this.now() - began)); } }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: source: Source; phase: Phase
   * 输出 / Returns: `() => { if (!ended) { ended = true; this.observe(source, phase, Math.max(0, this.now() - began)); } }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  start(source: Source, phase: Phase) {
    const began = this.now();
    let ended = false;
    return () => {
      if (!ended) {
        ended = true;
        this.observe(source, phase, Math.max(0, this.now() - began));
      }
    };
  }
  /**
   * 入口 / Entry: RuntimeTimings.measure.
   * 功能：在记录固定来源与阶段的运行耗时中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await work()` 供上层消费（`RuntimeTimings`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RuntimeTimings`; this entry produces `await work()` for its caller. Module context: Records timings for fixed sources/phases, exposing composable measurements and bounded diagnostic snapshots.
   * 处理：通过 `this.start`, `work`, `end` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.start`, `work`, `end`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: source: Source; phase: Phase; work: () => T | Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `await work()`.
   * 副作用 / Effects: `this.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `end();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `end();`; these steps also apply to exceptional exits.
   */
  async measure<T>(source: Source, phase: Phase, work: () => T | Promise<T>): Promise<T> {
    const end = this.start(source, phase);
    try {
      return await work();
    } finally {
      end();
    }
  }
  /**
   * 入口 / Entry: RuntimeTimings.snapshot.
   * 功能：在记录固定来源与阶段的运行耗时中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ windowMs: this.windowMs, maxSamplesPerSeries: this.maxSamples, series: [...this.series.values()] .map((entry) => { entry.sa…` 供上层消费（`RuntimeTimings`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `RuntimeTimings`; this entry produces `{ windowMs: this.windowMs, maxSamplesPerSeries: this.maxSamples, series: [...this.series.values()] .map((entry) => { entry.sa…` for its caller. Module context: Records timings for fixed sources/phases, exposing composable measurements and bounded diagnostic snapshots.
   * 处理：通过 `this.now`, `inline.map().filter`, `inline.map`, `this.series.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.now`, `inline.map().filter`, `inline.map`, `this.series.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ windowMs: this.windowMs, maxSamplesPerSeries: this.maxSamples, series: [...this.series.values()] .map((entry) => { entry.sa…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  snapshot() {
    const now = this.now();
    /**
     * 入口 / Entry: RuntimeTimings.snapshot.callback@58.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.map）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.map).
     * 输入 / Inputs: entry
     * 输出 / Returns: `{ source: entry.source, phase: entry.phase, samples: values.length, totalMs: values.reduce((total, ms) => total + ms, 0), max…`.
     * 副作用 / Effects: 更新 / updates `entry.samples`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return {
      windowMs: this.windowMs,
      maxSamplesPerSeries: this.maxSamples,
      series: [...this.series.values()]
        .map((entry) => {
          entry.samples = entry.samples.filter((sample) => now - sample.at <= this.windowMs);
          const values = entry.samples.map((sample) => sample.ms).sort((a, b) => a - b);
          /**
           * 入口 / Entry: RuntimeTimings.snapshot.percentile.
           * 功能：从当前输入或状态计算 `(values.length ? values[Math.ceil(values.length * p) - 1] : 0)`，供调用方后续验证或使用。
           * Purpose: Computes `(values.length ? values[Math.ceil(values.length * p) - 1] : 0)` from current inputs/state for the caller to validate or consume.
           * 输入 / Inputs: p: number
           * 输出 / Returns: `(values.length ? values[Math.ceil(values.length * p) - 1] : 0)`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           */
          const percentile = (p: number) => (values.length ? values[Math.ceil(values.length * p) - 1] : 0);
          return {
            source: entry.source,
            phase: entry.phase,
            samples: values.length,
            totalMs: values.reduce((total, ms) => total + ms, 0),
            maxMs: values.at(-1) || 0,
            p95Ms: percentile(0.95),
            p99Ms: percentile(0.99),
          };
        })
        .filter((entry) => entry.samples > 0),
    };
  }
}
export const runtimeTimings = new RuntimeTimings();
