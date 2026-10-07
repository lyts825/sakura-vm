/**
 * 模块职责：采集事件循环延迟、利用率及运行阶段耗时，关闭时停用当前控制器的直方图。
 * Module purpose: Samples event-loop latency/utilization and phase timings, disabling the controller's histogram on close.
 */
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { runtimeTimings } from './runtime-timings.ts';

/** One bounded histogram per controller. Identities belong in records, never metric labels. */
export class RuntimeDiagnostics {
  private histogram = monitorEventLoopDelay({ resolution: 20 });
  private started = performance.now();
  private utilization = performance.eventLoopUtilization();
  private closed = false;
  /**
   * 入口 / Entry: RuntimeDiagnostics.constructor.
   * 功能：建立 RuntimeDiagnostics 的采集事件循环延迟、利用率及运行阶段耗时上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the RuntimeDiagnostics context for this module's responsibility: Samples event-loop latency/utilization and phase timings, disabling the controller's histogram on close. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor() {
    this.histogram.enable();
  }
  /**
   * 入口 / Entry: RuntimeDiagnostics.snapshot.
   * 功能：在采集事件循环延迟、利用率及运行阶段耗时中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ measuredForMs: Math.max(0, performance.now() - this.started), state: this.closed ? 'closed' : 'measuring', phaseTimings: ru…` 供上层消费（`RuntimeDiagnostics`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `RuntimeDiagnostics`; this entry produces `{ measuredForMs: Math.max(0, performance.now() - this.started), state: this.closed ? 'closed' : 'measuring', phaseTimings: ru…` for its caller. Module context: Samples event-loop latency/utilization and phase timings, disabling the controller's histogram on close.
   * 处理：通过 `performance.now`, `runtimeTimings.snapshot`, `this.histogram.percentile`, `performance.eventLoopUtilization` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `performance.now`, `runtimeTimings.snapshot`, `this.histogram.percentile`, `performance.eventLoopUtilization`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ measuredForMs: Math.max(0, performance.now() - this.started), state: this.closed ? 'closed' : 'measuring', phaseTimings: ru…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  snapshot() {
    const count = this.histogram.count;
    return {
      measuredForMs: Math.max(0, performance.now() - this.started),
      state: this.closed ? 'closed' : 'measuring',
      phaseTimings: runtimeTimings.snapshot(),
      eventLoop: {
        samples: count,
        meanMs: count ? this.histogram.mean / 1e6 : 0,
        p99Ms: count ? this.histogram.percentile(99) / 1e6 : 0,
        maxMs: count ? this.histogram.max / 1e6 : 0,
        utilization: performance.eventLoopUtilization(this.utilization).utilization,
      },
    };
  }
  /**
   * 入口 / Entry: RuntimeDiagnostics.close.
   * 功能：在采集事件循环延迟、利用率及运行阶段耗时中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`RuntimeDiagnostics`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `RuntimeDiagnostics`; the outcome is recorded in `this.closed`. Module context: Samples event-loop latency/utilization and phase timings, disabling the controller's histogram on close.
   * 处理：通过 `this.histogram.disable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.histogram.disable`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    this.histogram.disable();
    this.closed = true;
  }
}
