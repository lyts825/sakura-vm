import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { z } from 'zod';
import { DATA, type VMStatus } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import { haFailoverOptions } from './ha-failover.ts';
import type { Machines } from './machines.ts';

const INTERVAL_MS = 15_000;
const monitorSchema = z.object({
  armed: z.boolean(),
  consecutiveFailures: z.number().int().min(0),
  observedState: z.enum(['stopped', 'starting', 'running', 'paused', 'stopping', 'error']),
  observedAt: z.string(),
  policyVersion: z.string().optional(),
  lastHealthyAt: z.string().optional(),
  suspectedAt: z.string().optional(),
});
export type HaMonitorStatus = z.infer<typeof monitorSchema>;
type Policy = { enabled: boolean; options: unknown; updatedAt?: string };
type MachineStates = Pick<Machines, 'state'> & EventEmitter;

export function advanceHaMonitor(previous: HaMonitorStatus | undefined, source: VMStatus,
  policy: Policy, at: string, countFailure: boolean): HaMonitorStatus {
  const options = haFailoverOptions.parse(policy.options);
  if (previous?.policyVersion !== policy.updatedAt) previous = undefined;
  if (previous && !countFailure && previous.observedState === source) return previous;
  const base: HaMonitorStatus = previous || {
    armed: false, consecutiveFailures: 0, observedState: source, observedAt: at,
    policyVersion: policy.updatedAt,
  };
  if (!policy.enabled || !options.targetHostId || source === 'stopping' || source === 'paused')
    return { armed: false, consecutiveFailures: 0, observedState: source, observedAt: at,
      policyVersion: policy.updatedAt,
      lastHealthyAt: base.lastHealthyAt };
  if (source === 'running')
    return { armed: true, consecutiveFailures: 0, observedState: source, observedAt: at,
      policyVersion: policy.updatedAt,
      lastHealthyAt: at };
  if (source === 'starting')
    return { ...base, observedState: source, observedAt: at };
  const failures = base.armed && countFailure
    ? Math.min(options.failureThreshold, base.consecutiveFailures + 1)
    : base.consecutiveFailures;
  return { ...base, consecutiveFailures: failures, observedState: source, observedAt: at,
    suspectedAt: failures >= options.failureThreshold ? base.suspectedAt || at : undefined };
}

export class HaFailureMonitor {
  private statuses: Record<string, HaMonitorStatus> = {};
  private timer?: ReturnType<typeof setInterval>;
  private work = Promise.resolve();
  private closed = false;
  private initialized = false;

  constructor(private machines: MachineStates,
    private policies: () => Promise<Record<string, Policy>>,
    private file = join(DATA, 'ha-failure-monitor.json')) {}

  private enqueue(task: () => Promise<void>) {
    this.work = this.work.catch(() => {}).then(task);
    return this.work;
  }

  private change = () => {
    const observed = new Map<string, VMStatus>();
    for (const id of Object.keys(this.statuses)) {
      try { observed.set(id, this.machines.state(id)); } catch { /* Deleted instance. */ }
    }
    void this.enqueue(() => this.scan(false, observed)).catch((error) =>
      console.error('HA 状态观察失败：', error));
  };

  private stopRequested = (id: string) => {
    const status = this.statuses[id];
    if (!status || this.closed) return;
    this.statuses[id] = { ...status, armed: false, consecutiveFailures: 0,
      observedState: 'stopping', observedAt: new Date().toISOString(),
      suspectedAt: undefined };
    void this.enqueue(() => writeStore(this.file, this.statuses)).catch((error) =>
      console.error('HA 停机观察失败：', error));
  };

  async init() {
    const stored = await readStore(this.file, () => ({}));
    if (stored && typeof stored === 'object' && !Array.isArray(stored))
      for (const [id, raw] of Object.entries(stored)) {
        const parsed = monitorSchema.safeParse(raw);
        if (parsed.success) this.statuses[id] = parsed.data;
      }
    await this.scan(false);
    this.initialized = true;
    this.machines.on('change', this.change);
    this.machines.on('stop-requested', this.stopRequested);
    this.timer = setInterval(() => void this.sample().catch((error) =>
      console.error('HA 故障采样失败：', error)), INTERVAL_MS);
    this.timer.unref();
  }

  private async scan(countFailure: boolean, observed?: Map<string, VMStatus>) {
    if (this.closed) return;
    const policies = await this.policies();
    const next = { ...this.statuses };
    const at = new Date().toISOString();
    for (const id of Object.keys(next)) if (!(id in policies)) delete next[id];
    for (const [id, policy] of Object.entries(policies)) {
      let source = observed?.get(id);
      try { source ||= this.machines.state(id); }
      catch { delete next[id]; continue; }
      const options = haFailoverOptions.safeParse(policy.options);
      if (!options.success) { delete next[id]; continue; }
      next[id] = advanceHaMonitor(next[id], source, policy, at, countFailure);
    }
    if (JSON.stringify(next) !== JSON.stringify(this.statuses)) {
      await writeStore(this.file, next);
      this.statuses = next;
    }
  }

  sample() { return this.enqueue(() => this.scan(true)); }

  async reconfigure(id: string) {
    await this.enqueue(async () => {
      delete this.statuses[id];
      await this.scan(false);
    });
  }

  view(id: string) {
    const status = this.statuses[id];
    return status ? { ...status, suspected: !!status.suspectedAt,
      sampleIntervalSeconds: INTERVAL_MS / 1000 } : null;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.machines.off('change', this.change);
    this.machines.off('stop-requested', this.stopRequested);
    await this.work.catch(() => {});
    if (!this.initialized) return;
    const at = new Date().toISOString();
    for (const status of Object.values(this.statuses)) {
      status.armed = false;
      status.consecutiveFailures = 0;
      delete status.suspectedAt;
      status.observedAt = at;
    }
    await writeStore(this.file, this.statuses);
  }
}
