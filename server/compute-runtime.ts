/**
 * 模块职责：管理有期限的计算工作线程与宿主资源额度；退出未确认的线程保留清理状态。
 */
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { AppError } from '../shared/errors.ts';
import { pluginAuthority, withPluginAuthority } from './plugin-authority.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { withinDeadline } from './plugin-scope.ts';
import { hostRuntime, type HostRuntime, type ResourceLease } from './host-runtime/index.ts';
import { runtimeTimings } from './runtime-timings.ts';

export type ComputeWork = { source: string | URL; options?: WorkerOptions };
type ComputeOptions = { owner: string; label: string; memoryBytes: number; signal?: AbortSignal;
  timeoutMs?: number; partition?: { key: string; limit: number } };
type Retiring = { worker: Worker; lease: ResourceLease; exit: Promise<void>; instance?: PluginInstance };

/** Trusted adapters choose fixed code; callers supply data only. Workers are created
 * on demand and retire after one task, so idle capacity returns to the host. */
export class ComputeRuntime {
  private readonly abort = new AbortController();
  private tasks = new Set<Promise<unknown>>();
  private retiring = new Set<Retiring>();
  constructor(private readonly registry: HostRuntime = hostRuntime,
    private readonly spawn = (source: string | URL, options?: WorkerOptions) => new Worker(source, options)) {}

  run<T>(options: ComputeOptions, prepare: (signal: AbortSignal) => ComputeWork | Promise<ComputeWork>): Promise<T> {
    const instance = pluginAuthority();
    instance?.check('compute', true);
    if (instance) {
      options = { ...options, owner: instance.owner,
        signal: options.signal ? AbortSignal.any([options.signal, instance.signal]) : instance.signal };
      const original = prepare;
      prepare = signal => withPluginAuthority(instance, () => original(signal), () => instance.check('compute', true));
    }
    if (this.abort.signal.aborted) return Promise.reject(new AppError('计算服务正在关闭', 503, 'RESOURCE_DRAINING'));
    const task = this.execute<T>(options, prepare);
    instance?.scope.observe(task);
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
    return task;
  }

  private async execute<T>(options: ComputeOptions, prepare: (signal: AbortSignal) => ComputeWork | Promise<ComputeWork>): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new AppError('计算执行期限无效', 400, 'RESOURCE_INVALID');
    const signal = options.signal ? AbortSignal.any([this.abort.signal, options.signal]) : this.abort.signal;
    const lease = await runtimeTimings.measure('compute', 'queue', () => this.registry.acquire({ owner: options.owner, kind: 'compute-worker', label: options.label,
      cost: { 'compute.worker': 1, 'compute.memory': options.memoryBytes }, signal,
      partitions: options.partition ? [options.partition] : undefined }));
    let worker: Worker;
    try {
      // Reserve memory before loading/copying any input, including while queued.
      const work = await prepare(signal);
      signal.throwIfAborted();
      worker = this.spawn(work.source, work.options);
    } catch (error) { lease.release(); throw error; }
    const endExecution = runtimeTimings.start('compute', 'execution');
    let endCleanup: (() => void) | undefined;
    const result = await new Promise<T>((resolve, reject) => {
      let complete = false, outcome: { result?: T; error?: unknown } | undefined;
      let ended!: () => void;
      const retiring = { worker, lease, instance: pluginAuthority(), exit: new Promise<void>((done) => { ended = done; }) };
      this.retiring.add(retiring);
      const cleanListeners = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
      const settle = () => {
        if (complete) return;
        complete = true; cleanListeners();
        if (outcome && !('error' in outcome)) resolve(outcome.result as T);
        else reject(outcome?.error ?? new AppError('计算工作线程提前退出', 502, 'COMPUTE_EXIT'));
      };
      const stop = (next: NonNullable<typeof outcome>) => {
        if (outcome) return;
        endExecution(); endCleanup = runtimeTimings.start('compute', 'cleanup');
        outcome = next; cleanListeners();
        // The exit event is the physical release receipt. A rejected terminate
        // keeps ownership registered and is retried by close(), never guessed.
        void worker.terminate().catch((error) => {
          if (!this.retiring.has(retiring)) return;
          const failure = new AppError(`计算工作线程清理尚未确认：${String(error)}`, 503, 'COMPUTE_CLEANUP_PENDING');
          lease.cleanupPending(failure); outcome = { error: failure }; settle();
        });
      };
      const aborted = () => stop({ error: signal.reason });
      const timer = setTimeout(() => stop({ error: new AppError('计算执行超时', 408, 'COMPUTE_TIMEOUT') }), timeoutMs);
      worker.once('message', (message: { ok?: boolean; result?: T; error?: string; status?: number; code?: string } | null) => {
        if (message?.ok === true) stop({ result: message.result });
        else stop({ error: new AppError(message?.error || '计算返回无效结果',
          Number.isInteger(message?.status) && message!.status! >= 400 && message!.status! <= 599 ? message!.status! : 409,
          message?.code || 'COMPUTE_FAILED') });
      });
      worker.once('error', (error) => stop({ error }));
      worker.once('exit', () => {
        endExecution(); endCleanup?.();
        cleanListeners(); lease.release(); this.retiring.delete(retiring); ended(); settle();
      });
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
    signal.throwIfAborted();
    return result;
  }

  beginDrain() { this.abort.abort(new AppError('计算服务正在关闭', 503, 'RESOURCE_DRAINING')); }
  async recover(instance: PluginInstance) {
    const receipts = [...this.retiring].filter(entry => entry.instance?.identity === instance.identity &&
      entry.instance.generation === instance.generation);
    for (const { worker, exit } of receipts)
      await withinDeadline(Promise.resolve(worker.terminate()).then(() => exit), 5000, '原计算线程清理');
  }
  async close() {
    this.beginDrain();
    await Promise.allSettled([...this.tasks]);
    const results = await Promise.allSettled([...this.retiring].map(async ({ worker, exit }) => {
      await worker.terminate(); await exit;
    }));
    if (results.some((result) => result.status === 'rejected') || this.retiring.size)
      throw new AppError('计算工作线程清理尚未确认', 503, 'COMPUTE_CLEANUP_PENDING');
  }
}

export const computeRuntime = new ComputeRuntime();
