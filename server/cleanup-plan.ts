/** 中文：注册有明确归属的清理提供者，以一次性预览令牌约束执行。English: Registered cleanup providers execute against one-use preview tokens. */
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import type { CleanupProviderId, CleanupSnapshot, CleanupPreview, CleanupResult } from '../shared/contracts/cleanup-plan.ts';

export interface CleanupProvider {
  id: CleanupProviderId;
  label: string;
  description: string;
  snapshot(signal: AbortSignal): Promise<CleanupSnapshot> | CleanupSnapshot;
  execute(revision: string, signal: AbortSignal): Promise<Omit<CleanupResult, 'provider'>>;
}

export class CleanupPlans {
  private providers = new Map<CleanupProviderId, CleanupProvider>();
  private plans = new Map<string, { provider: CleanupProviderId; revision: string; expires: number }>();
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  constructor(private now = Date.now) {}

  /** 中文：注册唯一提供者；不允许任意路径作为清理范围。English: Register a unique provider; arbitrary paths are never accepted. */
  register(provider: CleanupProvider) {
    if (this.providers.has(provider.id)) throw new Error('重复的清理提供者');
    this.providers.set(provider.id, provider);
  }
  list() {
    return { providers: [...this.providers.values()].map(({ id, label, description }) => ({ id, label, description })) };
  }
  private track<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const combined = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    const task = Promise.resolve().then(() => { combined.throwIfAborted(); return work(combined); });
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task)).catch(() => {});
    return task;
  }
  private provider(id: CleanupProviderId) {
    const provider = this.providers.get(id);
    if (!provider) throw new AppError('清理提供者不可用', 404);
    return provider;
  }
  preview(id: CleanupProviderId, signal?: AbortSignal): Promise<CleanupPreview> {
    return this.track(async (scope) => {
      const snapshot = await this.provider(id).snapshot(scope);
      scope.throwIfAborted();
      const expires = this.now() + 5 * 60_000, token = randomUUID();
      for (const [key, plan] of this.plans) if (plan.expires <= this.now() || plan.provider === id) this.plans.delete(key);
      this.plans.set(token, { provider: id, revision: snapshot.revision, expires });
      const candidates = snapshot.entries.filter((item) => item.eligible);
      return { ...snapshot, provider: id, token, expiresAt: new Date(expires).toISOString(),
        candidateCount: candidates.length, estimatedBytes: candidates.reduce((sum, item) => sum + item.bytes, 0) };
    }, signal);
  }
  execute(id: CleanupProviderId, token: string, signal?: AbortSignal, beforeDispatch?: () => Promise<void>): Promise<CleanupResult> {
    return this.track(async (scope) => {
      const plan = this.plans.get(token);
      // 中文：先消费令牌，失败或取消后也必须重新预览。English: Consume before dispatch; failure/cancellation also requires a new preview.
      this.plans.delete(token);
      if (!plan || plan.provider !== id || plan.expires <= this.now()) throw new AppError('清理预览已失效，请重新预览', 409);
      await beforeDispatch?.();
      scope.throwIfAborted();
      const result = await this.provider(id).execute(plan.revision, scope);
      return { provider: id, ...result };
    }, signal);
  }
  async close() {
    this.controller.abort(new AppError('清理中心已关闭', 503));
    this.plans.clear();
    await Promise.allSettled([...this.pending]);
    this.providers.clear();
  }
}
