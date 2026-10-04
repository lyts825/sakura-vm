import type { JobsV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { Jobs } from './jobs.ts';
import { hostRuntime, type ResourceLease } from './host-runtime/index.ts';
import { pluginAuthority, withPluginBackground } from './plugin-authority.ts';
import type { PluginInstance } from './plugin-instance.ts';

export type ScheduleDefinition = {
  id?: string;
  owner: string;
  label: string;
  intervalMs: number;
  immediate?: boolean;
  overlap?: 'skip' | 'coalesce';
  /** On a late wakeup, skip expired ticks or run at most one catch-up. */
  catchUp?: 'skip' | 'once';
  timeoutMs?: number;
  backoff?: { initialMs: number; maxMs: number; factor?: number };
  run(context: { signal: AbortSignal; scheduledAt: string }): Promise<void>;
};
export type ScheduleView = {
  id: string; owner: string; label: string; intervalMs: number;
  overlap: 'skip' | 'coalesce'; catchUp: 'skip' | 'once';
  state: 'scheduled' | 'queued' | 'running' | 'cancelling' | 'backoff' | 'cleanup-pending' | 'closed';
  nextAt?: string; lastStartedAt?: string; lastFinishedAt?: string;
  lastDurationMs?: number; lastError?: string; timedOutAt?: string;
  jobId?: string; cleanupLeaseId?: string;
  runs: number; failures: number; skipped: number; coalesced: number;
};
export type ScheduleHandle = { id: string; trigger(): boolean; snapshot(): ScheduleView; close(): Promise<void>;
  resolveCleanup(jobId: string): Promise<void> };
type Entry = { definition: ScheduleDefinition; view: ScheduleView; jobs: JobsV1; lease: ResourceLease; nextAt: number;
  lifetime?: PluginInstance;
  notBefore: number; queued: boolean; closed: boolean; abort?: AbortController;
  pending?: Promise<void>; closeTask?: Promise<void>; cleanupFailure?: unknown };

const maximumDelay = 2_147_483_647;
function duration(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumDelay) throw new RangeError(`Invalid ${label}`);
}

/** One timer owns periodic wakeups. Jobs provides global admission and nested budget delegation. */
export class Scheduler {
  private entries = new Map<string, Entry>();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private closeTask?: Promise<void>;

  register(definition: ScheduleDefinition): ScheduleHandle {
    const lifetime = pluginAuthority();
    lifetime?.check('schedule', true);
    if (lifetime) definition = { ...definition, owner: lifetime.owner };
    if (this.closed) throw new AppError('周期调度正在关闭', 503, 'SCHEDULER_CLOSED');
    duration(definition.intervalMs, 'schedule interval');
    if (definition.timeoutMs !== undefined) duration(definition.timeoutMs, 'schedule timeout');
    if (!definition.owner || !definition.label || definition.owner.length > 200 || definition.label.length > 200)
      throw new TypeError('Schedule owner and label are required and must be at most 200 characters');
    if (definition.overlap !== undefined && !['skip', 'coalesce'].includes(definition.overlap)) throw new TypeError('Invalid overlap policy');
    if (definition.catchUp !== undefined && !['skip', 'once'].includes(definition.catchUp)) throw new TypeError('Invalid catch-up policy');
    if (definition.backoff) {
      duration(definition.backoff.initialMs, 'initial backoff'); duration(definition.backoff.maxMs, 'maximum backoff');
      if (definition.backoff.initialMs > definition.backoff.maxMs || !Number.isFinite(definition.backoff.factor ?? 2) ||
          (definition.backoff.factor ?? 2) < 1) throw new RangeError('Invalid schedule backoff');
    }
    const id = definition.id || randomUUID();
    lifetime?.contribute('schedule', definition.label);
    if (this.entries.has(id)) throw new AppError('周期任务标识已存在', 409, 'SCHEDULE_EXISTS');
    if (this.entries.size >= 1024 || [...this.entries.values()].filter((entry) => entry.definition.owner === definition.owner).length >= 64)
      throw new AppError('周期任务登记已达到上限', 429, 'SCHEDULE_LIMIT');
    const entry: Entry = { lifetime, definition: { ...definition, backoff: definition.backoff && { ...definition.backoff } },
      view: { id, owner: definition.owner, label: definition.label, intervalMs: definition.intervalMs,
        overlap: definition.overlap || 'skip', catchUp: definition.catchUp || 'once', state: 'scheduled',
        runs: 0, failures: 0, skipped: 0, coalesced: 0 },
      jobs: new Jobs(), lease: hostRuntime.register({ owner: definition.owner, kind: 'schedule', label: definition.label, lane: 'background' }),
      nextAt: Date.now() + (definition.immediate ? 0 : definition.intervalMs),
      notBefore: 0, queued: false, closed: false };
    this.entries.set(id, entry); this.arm();
    if (lifetime) {
      const cancel = () => { void this.closeEntry(entry).catch(() => {}); };
      lifetime.signal.addEventListener('abort', cancel, { once: true });
      lifetime.scope.add(async () => { await this.closeEntry(entry); lifetime.signal.removeEventListener('abort', cancel); });
    }
    return { id, trigger: () => this.trigger(entry), snapshot: () => this.describe(entry), close: () => this.closeEntry(entry),
      resolveCleanup: (jobId) => entry.jobs.resolveCleanup(jobId) };
  }

  private describe(entry: Entry): ScheduleView {
    const job = entry.jobs.view('run'), admission = job?.admission;
    const state = entry.cleanupFailure ? 'cleanup-pending' : entry.pending
      ? entry.abort?.signal.aborted ? 'cancelling' : admission === 'queued' ? 'queued' : 'running'
      : entry.closed ? 'closed' : entry.notBefore > Date.now() ? 'backoff' : 'scheduled';
    return { ...entry.view, state, jobId: job?.id, cleanupLeaseId: admission === 'cleanup-pending' ? job?.cleanupLeaseId : undefined,
      nextAt: entry.closed ? undefined : new Date(Math.max(entry.nextAt, entry.notBefore)).toISOString() };
  }
  snapshot(): ScheduleView[] { return [...this.entries.values()].map((entry) => this.describe(entry)); }

  private arm() {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.closed || !this.entries.size) return;
    let next = Infinity;
    for (const entry of this.entries.values()) if (!entry.closed && !entry.cleanupFailure) next = Math.min(next, Math.max(entry.nextAt, entry.notBefore));
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.wake(); }, Math.min(maximumDelay, Math.max(1, next - Date.now())));
    this.timer.unref();
  }
  private wake() {
    if (this.closed) return;
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.closed || entry.cleanupFailure || Math.max(entry.nextAt, entry.notBefore) > now) continue;
      const scheduledAt = entry.nextAt;
      const missed = Math.floor(Math.max(0, now - scheduledAt) / entry.definition.intervalMs);
      entry.nextAt = scheduledAt + (missed + 1) * entry.definition.intervalMs;
      if (missed && entry.view.catchUp === 'skip' && !entry.queued) { entry.view.skipped += missed + 1; continue; }
      if (entry.pending) this.overlapping(entry, missed + 1);
      else { entry.view.skipped += missed; this.launch(entry, scheduledAt); }
    }
    this.arm();
  }
  private overlapping(entry: Entry, count = 1) {
    if (entry.view.overlap === 'coalesce') { entry.queued = true; entry.view.coalesced += count; }
    else entry.view.skipped += count;
  }
  private trigger(entry: Entry) {
    if (this.closed || entry.closed || entry.cleanupFailure) return false;
    if (entry.pending) { this.overlapping(entry); return entry.view.overlap === 'coalesce'; }
    if (entry.notBefore > Date.now()) { entry.queued = true; this.arm(); return true; }
    this.launch(entry, Date.now()); this.arm(); return true;
  }
  private launch(entry: Entry, scheduledAt: number) {
    if (entry.lifetime?.phase === 'activating') { entry.nextAt = Date.now() + 50; return; }
    if (entry.lifetime?.signal.aborted) { void this.closeEntry(entry).catch(() => {}); return; }
    entry.queued = false;
    const abort = new AbortController(); entry.abort = abort;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const launch = () => Jobs.detached(() => entry.jobs.track('run', async (_log, signal) => {
      entry.view.runs++; entry.view.lastStartedAt = new Date().toISOString(); entry.view.timedOutAt = undefined;
      const began = performance.now();
      if (entry.definition.timeoutMs !== undefined) timeout = setTimeout(() => {
        entry.view.timedOutAt = new Date().toISOString();
        abort.abort(new AppError('周期任务执行超时，正在等待清理', 503, 'SCHEDULE_TIMEOUT'));
      }, entry.definition.timeoutMs);
      try { await entry.definition.run({ signal, scheduledAt: new Date(scheduledAt).toISOString() }); }
      finally { clearTimeout(timeout); entry.view.lastDurationMs = performance.now() - began; }
    }, { owner: entry.definition.owner, title: entry.definition.label, lane: 'background' }, abort.signal));
    const pending = (entry.lifetime ? withPluginBackground(entry.lifetime, launch) : launch())
      .then(() => { entry.view.failures = 0; entry.view.lastError = undefined; entry.notBefore = 0; })
      .catch((error: unknown) => {
        if (entry.jobs.view('run')?.admission === 'cleanup-pending') {
          entry.cleanupFailure = error; entry.lease.cleanupPending(error);
        } else if (entry.closed) return;
        entry.view.failures++;
        entry.view.lastError = entry.view.timedOutAt && entry.jobs.view('run')?.admission !== 'cleanup-pending'
          ? '周期任务执行超时，清理已完成' : error instanceof Error ? error.message : String(error);
        const backoff = entry.definition.backoff;
        if (backoff) {
          const wait = Math.min(backoff.maxMs, backoff.initialMs * (backoff.factor ?? 2) ** Math.min(1024, entry.view.failures - 1));
          entry.notBefore = Date.now() + wait;
          entry.nextAt = Math.max(entry.nextAt, entry.notBefore);
        }
      })
      .finally(() => {
        clearTimeout(timeout); entry.view.lastFinishedAt = new Date().toISOString();
        entry.pending = undefined; entry.abort = undefined;
        if (entry.queued && !entry.closed) entry.nextAt = Math.max(Date.now(), entry.notBefore);
        this.arm();
      });
    entry.pending = pending;
  }
  private closeEntry(entry: Entry): Promise<void> {
    if (entry.closeTask) return entry.closeTask;
    return entry.closeTask = (async () => {
      entry.closed = true; entry.queued = false;
      entry.abort?.abort(new AppError('周期任务正在关闭', 503, 'SCHEDULE_CLOSED'));
      this.arm();
      await entry.pending; await entry.jobs.close();
      const pending = entry.jobs.list().find((job) => job.admission === 'cleanup-pending');
      if (pending) throw new AppError(pending.error || '周期任务资源清理尚未确认', 503, pending.errorCode || 'SCHEDULE_CLEANUP_PENDING');
      entry.cleanupFailure = undefined; entry.lease.release();
      this.entries.delete(entry.view.id); this.arm();
    })().catch((error) => {
      entry.cleanupFailure = error; entry.lease.cleanupPending(error); entry.closeTask = undefined; throw error;
    });
  }
  beginDrain() {
    this.closed = true; clearTimeout(this.timer); this.timer = undefined;
    for (const entry of this.entries.values()) {
      entry.closed = true; entry.queued = false;
      entry.abort?.abort(new AppError('周期任务正在关闭', 503, 'SCHEDULE_CLOSED'));
    }
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    return this.closeTask = (async () => {
      this.beginDrain();
      const results = await Promise.allSettled([...this.entries.values()].map((entry) => this.closeEntry(entry)));
      const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, '周期任务清理未完成');
    })().catch((error) => { this.closeTask = undefined; throw error; });
  }
}

export const scheduler = new Scheduler();
