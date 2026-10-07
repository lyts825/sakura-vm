/**
 * 模块职责：记录固定来源与阶段的运行耗时，提供可组合的测量和诊断快照。
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
  constructor(private now: () => number = () => performance.now()) {}
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
  async measure<T>(source: Source, phase: Phase, work: () => T | Promise<T>): Promise<T> {
    const end = this.start(source, phase);
    try {
      return await work();
    } finally {
      end();
    }
  }
  snapshot() {
    const now = this.now();
    return {
      windowMs: this.windowMs,
      maxSamplesPerSeries: this.maxSamples,
      series: [...this.series.values()]
        .map((entry) => {
          entry.samples = entry.samples.filter((sample) => now - sample.at <= this.windowMs);
          const values = entry.samples.map((sample) => sample.ms).sort((a, b) => a - b);
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
