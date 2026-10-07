/**
 * 模块职责：采集事件循环延迟、利用率及运行阶段耗时，关闭时停用当前控制器的直方图。
 */
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { runtimeTimings } from './runtime-timings.ts';

/** One bounded histogram per controller. Identities belong in records, never metric labels. */
export class RuntimeDiagnostics {
  private histogram = monitorEventLoopDelay({ resolution: 20 });
  private started = performance.now();
  private utilization = performance.eventLoopUtilization();
  private closed = false;
  constructor() {
    this.histogram.enable();
  }
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
  close() {
    this.histogram.disable();
    this.closed = true;
  }
}
