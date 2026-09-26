import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import type { Jobs, JobView } from './jobs.ts';
import { readStore, writeStore } from './local-store.ts';
import type { LogRetentionPolicy, LogRetentionSummary, LogRetentionView } from '../shared/log-retention.ts';

export const logRetentionPolicy = z
  .object({
    enabled: z.boolean(),
    days: z.number().int().min(1).max(3650),
    maxMiB: z.number().int().min(1).max(1024),
  })
  .strict();
export const logRetentionRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), policy: logRetentionPolicy }).strict(),
  z
    .object({
      action: z.literal('save'),
      policy: logRetentionPolicy,
      token: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
const defaults = (): LogRetentionPolicy => ({ enabled: false, days: 30, maxMiB: 64 });
const stateSchema = z
  .object({
    version: z.literal(1),
    policy: logRetentionPolicy,
    lastRun: z
      .object({
        at: z.iso.datetime(),
        removedLogs: z.number().int().nonnegative(),
        removedBytes: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .strict();

// Only completed job log bodies are eligible. Results and audit evidence are separate stores.
export function planLogRetention(stores: Jobs[], policy: LogRetentionPolicy, now = Date.now()) {
  const summary: LogRetentionSummary = {
    stores: stores.length,
    completedLogs: 0,
    completedBytes: 0,
    protectedLogs: 0,
    protectedBytes: 0,
    removeLogs: 0,
    removeBytes: 0,
    expiredLogs: 0,
    capacityLogs: 0,
    remainingBytes: 0,
  };
  const candidates: {
    store: Jobs;
    job: JobView;
    bytes: number;
    at: number;
    storeIndex: number;
    signature: string;
  }[] = [];
  stores.forEach((store, storeIndex) => {
    for (const job of store.list()) {
      const bytes = Buffer.byteLength(job.log);
      if (!bytes) continue;
      const at = Date.parse(job.finishedAt || job.startedAt);
      if (job.status === 'running' || !job.id || !Number.isFinite(at) || at > now) {
        summary.protectedLogs++;
        summary.protectedBytes += bytes;
        continue;
      }
      summary.completedLogs++;
      summary.completedBytes += bytes;
      candidates.push({
        store,
        job,
        bytes,
        at,
        storeIndex,
        signature: createHash('sha256').update(job.log).digest('hex'),
      });
    }
  });
  candidates.sort((a, b) => a.at - b.at || a.storeIndex - b.storeIndex || a.job.id!.localeCompare(b.job.id!));
  const removals: typeof candidates = [];
  let bytes = summary.completedBytes;
  if (policy.enabled)
    for (const item of candidates) {
      const expired = item.at <= now - policy.days * 86400000;
      if (!expired && bytes <= policy.maxMiB * 1024 ** 2) break;
      removals.push(item);
      bytes -= item.bytes;
      if (expired) summary.expiredLogs++;
      else summary.capacityLogs++;
    }
  summary.removeLogs = removals.length;
  summary.removeBytes = summary.completedBytes - bytes;
  summary.remainingBytes = bytes;
  // Hash completed evidence and policy, never return log text or hashes of individual messages.
  const token = createHash('sha256')
    .update(
      JSON.stringify({
        policy,
        candidates: candidates.map(({ storeIndex, job, signature, at }) => [
          storeIndex,
          job.id,
          at,
          signature,
        ]),
        remove: removals.map(({ storeIndex, job }) => [storeIndex, job.id]),
      }),
    )
    .digest('hex');
  return { summary, removals, token };
}

export class LogRetention {
  private state: z.infer<typeof stateSchema> = { version: 1, policy: defaults() };
  private warning?: string;
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private scheduled = false;
  constructor(
    private stores: () => Jobs[],
    private file = join(DATA, 'log-retention.json'),
    private blocked = () => false,
    private now = Date.now,
    private activity = (_delta: number) => {},
  ) {}
  async init(schedule = true) {
    try {
      this.state = stateSchema.parse(await readStore(this.file, () => this.state));
    } catch {
      this.warning = '日志策略读取失败，自动清理已停用；请检查并重新保存策略。';
    }
    if (schedule) {
      this.timer = setInterval(() => {
        if (this.scheduled || this.closed || this.blocked() || !this.state.policy.enabled) return;
        this.scheduled = true;
        void this.sweep()
          .catch(() => {})
          .finally(() => {
            this.scheduled = false;
          });
      }, 60000);
      this.timer.unref();
    }
  }
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new AppError('日志保留服务正在关闭', 503));
    const pending = this.queue
      .catch(() => {})
      .then(async () => {
        this.activity(1);
        try {
          return await work();
        } finally {
          this.activity(-1);
        }
      });
    this.queue = pending;
    return pending;
  }
  view(): LogRetentionView {
    return {
      policy: { ...this.state.policy },
      summary: planLogRetention(this.stores(), this.state.policy, this.now()).summary,
      lastRun: this.state.lastRun && { ...this.state.lastRun },
      warning: this.warning,
    };
  }
  preview(input: unknown) {
    const policy = logRetentionPolicy.parse(input);
    const plan = planLogRetention(this.stores(), policy, this.now());
    return { ...plan.summary, token: this.previewToken(plan.token) };
  }
  private previewToken(plan: string) {
    return createHash('sha256')
      .update(JSON.stringify([this.state.policy, plan]))
      .digest('hex');
  }
  save(input: unknown, token: string) {
    const policy = logRetentionPolicy.parse(input);
    return this.serialized(async () => {
      if (this.blocked()) throw new AppError('数据目录迁移维护中，日志清理已暂停', 409);
      const plan = planLogRetention(this.stores(), policy, this.now());
      if (this.previewToken(plan.token) !== token)
        throw new AppError('任务日志或策略已变化，请重新预览后保存', 409);
      const next = { ...this.state, policy };
      // A failed policy write must never enable automatic deletion.
      await writeStore(this.file, next);
      this.state = next;
      this.warning = undefined;
      if (policy.enabled) await this.apply(plan);
      return this.view();
    });
  }
  sweep() {
    return this.serialized(async () => {
      if (!this.state.policy.enabled || this.blocked()) return this.view();
      await this.apply(planLogRetention(this.stores(), this.state.policy, this.now()));
      return this.view();
    });
  }
  private async apply(plan: ReturnType<typeof planLogRetention>) {
    const at = new Date(this.now()).toISOString();
    let removedLogs = 0,
      removedBytes = 0;
    try {
      for (const store of new Set(plan.removals.map((item) => item.store))) {
        const items = plan.removals.filter((item) => item.store === store);
        const result = await store.clearCompletedLogs(
          items.map((item) => ({ id: item.job.id!, signature: item.signature })),
          at,
        );
        removedLogs += result.removedLogs;
        removedBytes += result.removedBytes;
      }
      const next = { ...this.state, lastRun: { at, removedLogs, removedBytes } };
      await writeStore(this.file, next);
      this.state = next;
      this.warning = undefined;
    } catch {
      this.warning = '日志清理未全部完成，请检查任务历史的磁盘空间和权限；已完成部分不会恢复，稍后可重试。';
      throw new AppError(this.warning, 500);
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.queue.catch(() => {});
  }
}
