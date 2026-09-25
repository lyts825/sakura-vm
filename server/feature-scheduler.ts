import type { FeatureSuite } from './feature-suite.ts';

/** The periodic worker is owned by its own plugin. */
export class FeatureScheduler {
  private timer: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private closed = false;
  private disable: () => void;
  constructor(private suite: FeatureSuite) {
    this.disable = suite.enableBackground();
    this.timer = setInterval(() => this.run(), 30_000);
    this.timer.unref();
    this.run();
  }
  private run() {
    if (this.closed || this.pending) return;
    const task = this.suite.tick().catch(() => {}).finally(() => {
      if (this.pending === task) this.pending = undefined;
    });
    this.pending = task;
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.disable();
    await this.pending;
  }
}
