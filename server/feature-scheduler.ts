import type { ServiceInterface } from './service-interface.ts';
import type { FeatureSuite } from './feature-suite.ts';
import { scheduler, type Scheduler, type ScheduleHandle } from './scheduler.ts';

/** The plugin owns its registration; the host scheduler owns periodic wakeups. */
export class FeatureScheduler {
  private registration: ScheduleHandle;
  private disable: () => void;
  private closeTask?: Promise<void>;
  constructor(private suite: ServiceInterface<FeatureSuite>, schedules: Scheduler = scheduler) {
    this.disable = suite.enableBackground();
    try { this.registration = schedules.register({ owner: 'plugin:automation-scheduler', label: 'Feature suite background checks',
      intervalMs: 30_000, immediate: true, overlap: 'skip', catchUp: 'once', timeoutMs: 120_000,
      backoff: { initialMs: 30_000, maxMs: 5 * 60_000 },
      run: async ({ signal }) => {
        signal.throwIfAborted();
        this.disable = this.suite.enableBackground();
        const disable = this.disable;
        signal.addEventListener('abort', disable, { once: true });
        try { await this.suite.tick(); }
        finally { signal.removeEventListener('abort', disable); }
      } }); }
    catch (error) { this.disable(); throw error; }
  }
  close(): Promise<void> {
    return this.closeTask ||= (async () => {
      this.disable();
      await this.registration.close();
    })().catch((error) => { this.closeTask = undefined; throw error; });
  }
}
