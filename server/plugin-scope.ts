import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { hostRuntime, type ResourceLease } from './host-runtime/index.ts';

type Disposer = { work: () => void | Promise<void>; pending?: Promise<void>; done?: boolean };
const operationLimit = 128;

export class PluginScope {
  private controller = new AbortController();
  private disposers: Disposer[] = [];
  private active = new Set<Promise<unknown>>();
  private failures = new Map<string, unknown>();
  private recoveries = new Map<string, Promise<void>>();
  private closing?: Promise<void>;
  private resource?: ResourceLease;
  constructor(owner?: string) {
    if (owner) this.resource = hostRuntime.register({ owner, kind: 'plugin-scope', label: '插件生命周期' });
  }
  get signal() {
    return this.controller.signal;
  }
  add(disposer: () => void | Promise<void>) {
    this.signal.throwIfAborted();
    this.disposers.push({ work: disposer });
  }
  /** Retain receipts from already admitted work, even when cancellation preceded their arrival. */
  retainCleanup(disposer: () => void | Promise<void>) {
    this.disposers.push({ work: disposer });
    return (confirmedError: unknown) => {
      for (const [id, error] of this.failures) if (error === confirmedError) this.failures.delete(id);
    };
  }
  abort(reason?: unknown) {
    this.controller.abort(reason);
  }
  run<T>(work: () => Promise<T> | T): Promise<T> {
    this.signal.throwIfAborted();
    if (this.active.size >= operationLimit) throw new AppError('插件等待队列已满', 429, 'PLUGIN_QUEUE_FULL');
    const pending = Promise.resolve().then(() => {
      this.signal.throwIfAborted();
      return work();
    });
    this.observe(pending);
    return pending;
  }
  observe(pending: Promise<unknown>) {
    if (this.active.has(pending)) return;
    this.active.add(pending);
    void pending.then(
      () => this.active.delete(pending),
      (error) => {
        this.active.delete(pending);
        if (
          error instanceof AppError &&
          error.status === 503 &&
          /CLEANUP|UNCONFIRMED/.test(error.code || '')
        ) {
          if (![...this.failures.values()].includes(error)) this.failures.set(randomUUID(), error);
          this.resource?.cleanupPending(error);
        }
      },
    );
  }
  diagnostics() {
    return {
      resourceId: this.resource?.id,
      active: this.active.size,
      revoked: this.signal.aborted,
      cleanup: [...this.failures].map(([id, error]) => ({ id, error: String(error) })),
    };
  }
  cleanupPending(error: unknown) {
    this.resource?.cleanupPending(error);
  }
  /** Trusted domain recovery must confirm physical cleanup before resolving its receipt. */
  async recoverCleanup(id: string, recover: () => Promise<void>) {
    if (!this.failures.has(id)) throw new AppError('清理回执不属于此插件', 404, 'PLUGIN_CLEANUP_UNKNOWN');
    const existing = this.recoveries.get(id);
    if (existing) return existing;
    const pending = Promise.resolve()
      .then(recover)
      .then(() => {
        this.failures.delete(id);
      });
    this.recoveries.set(id, pending);
    this.active.add(pending);
    try {
      await pending;
    } finally {
      this.active.delete(pending);
      this.recoveries.delete(id);
    }
  }
  async settled() {
    while (this.active.size) await Promise.allSettled([...this.active]);
  }
  dispose(
    run: (dispose: () => void | Promise<void>) => Promise<void> = async (dispose) => {
      await dispose();
    },
  ) {
    this.abort();
    if (this.closing) return this.closing;
    const closing = (async () => {
      this.resource?.beginCleanup?.();
      const errors: unknown[] = [];
      // Cancellation is not completion: callers may bound this wait, but retain this scope on timeout.
      await this.settled();
      for (const disposer of [...this.disposers].reverse()) {
        if (disposer.done) continue;
        try {
          await run(() => {
            if (!disposer.pending) {
              const pending = Promise.resolve().then(disposer.work);
              disposer.pending = pending;
              void pending.then(
                () => {
                  disposer.done = true;
                },
                () => {
                  disposer.pending = undefined;
                },
              );
            }
            return disposer.pending;
          });
        } catch (error) {
          if (!errors.includes(error)) errors.push(error);
        }
      }
      for (const error of this.failures.values()) if (!errors.includes(error)) errors.push(error);
      if (errors.length) {
        const error = new AggregateError(errors, '插件资源清理失败');
        this.resource?.cleanupPending(error);
        throw error;
      }
      this.disposers = [];
      this.resource?.release();
    })();
    this.closing = closing;
    void closing.catch(() => {
      if (this.closing === closing) this.closing = undefined;
    });
    return closing;
  }
}

export async function withinDeadline<T>(
  operation: Promise<T> | T,
  milliseconds: number,
  label: string,
  onTimeout: () => void = () => {},
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error(`${label}超过 ${milliseconds} 毫秒`));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
