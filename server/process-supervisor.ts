import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { hostRuntime, type ResourceLease } from './host-runtime/index.ts';
import { AppError } from '../shared/errors.ts';

export type ProcessAdmission = {
  owner: string;
  kind: 'vm' | 'tool' | 'helper';
  label: string;
  lane?: 'interactive' | 'background' | 'control';
  signal?: AbortSignal;
  queueTimeoutMs?: number;
};
export type HelperExit = { code: number | null; signal: NodeJS.Signals | null; failure: string };
type HelperOptions = Omit<ProcessAdmission, 'kind'> & {
  helper: 'virtiofsd' | 'swtpm';
  file: string;
  args: string[];
  onExit?: (exit: HelperExit) => void;
  graceMs?: number;
  closeTimeoutMs?: number;
};
type SpawnHelper = (file: string, args: string[]) => ChildProcess;
const startHelper: SpawnHelper = (file, args) =>
  spawn(file, args, {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
const cleanupError = () =>
  new AppError('宿主进程退出尚未确认，保留资源名额', 503, 'HOST_PROCESS_CLEANUP_PENDING');

/** The governor owns admission; adapters retain their native ownership protocols. */
export class ProcessSupervisor {
  constructor(
    private governor: Pick<typeof hostRuntime, 'acquire'> = hostRuntime,
    private spawnHelper: SpawnHelper = startHelper,
  ) {}

  private acquire(options: ProcessAdmission) {
    return this.governor.acquire({
      owner: options.owner,
      kind: 'process.' + options.kind,
      label: options.label,
      lane: options.lane || 'background',
      signal: options.signal,
      timeoutMs: options.queueTimeoutMs,
      cost: { process: 1, ['process.' + options.kind]: 1 },
    });
  }

  async run<T>(
    options: ProcessAdmission,
    operation: (control: { cleanupPending(error: unknown): void }) => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquire(options);
    let unresolved = false;
    try {
      options.signal?.throwIfAborted();
      // Never race the operation against abort. Its adapter must acknowledge exit.
      return await operation({
        cleanupPending(error) {
          unresolved = true;
          lease.cleanupPending(error);
        },
      });
    } finally {
      if (!unresolved) lease.release();
    }
  }

  async helper(options: HelperOptions): Promise<ManagedHelper> {
    if (!['virtiofsd', 'swtpm'].includes(options.helper)) throw new Error('Unknown managed helper');
    for (const value of [options.graceMs ?? 2000, options.closeTimeoutMs ?? 5000])
      if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)
        throw new Error('Invalid helper close deadline');
    const lease = await this.acquire({ ...options, kind: 'helper' });
    try {
      options.signal?.throwIfAborted();
      return new ManagedHelper(this.spawnHelper(options.file, [...options.args]), lease, options);
    } catch (error) {
      lease.release();
      throw error;
    }
  }
}

export class ManagedHelper {
  readonly closed: Promise<HelperExit>;
  private actual?: HelperExit;
  private ended = false;
  private closing = false;
  private closeTask?: Promise<void>;
  private tail = Buffer.alloc(0);
  private spawnFailure?: Error;
  private readonly abort: () => void;

  constructor(
    private child: ChildProcess,
    private lease: ResourceLease,
    private options: HelperOptions,
  ) {
    child.stderr?.on('data', (data: Buffer) => {
      this.tail = Buffer.concat([this.tail, data.subarray(-16384)]).subarray(-16384);
    });
    child.on('error', (error) => {
      this.spawnFailure = error;
    });
    let notified = false;
    const notify = (exit: HelperExit) => {
      if (this.closing || notified) return;
      notified = true;
      try {
        options.onExit?.(exit);
      } catch {
        /* The owner cannot prevent resource release. */
      }
    };
    child.once('exit', (code, signal) => {
      this.ended = true;
      notify({ code, signal, failure: this.failure });
    });
    this.closed = new Promise((resolve) =>
      child.once('close', (code, signal) => {
        this.ended = true;
        this.actual = { code, signal, failure: this.failure };
        options.signal?.removeEventListener('abort', this.abort);
        // A kill request and even an exit event are not physical stdio closure.
        lease.release();
        resolve(this.actual);
        notify(this.actual);
      }),
    );
    this.abort = () => {
      void this.close().catch(() => {});
    };
    options.signal?.addEventListener('abort', this.abort, { once: true });
    if (options.signal?.aborted) this.abort();
  }
  get failure() {
    return this.spawnFailure?.message || this.tail.toString('utf8').trim();
  }
  get exited() {
    return this.ended;
  }

  async ready(probe: () => Promise<boolean>, timeoutMs = 5000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)
      throw new Error('Invalid helper readiness deadline');
    const deadline = performance.now() + timeoutMs;
    while (!this.ended && !this.spawnFailure && !this.closing && performance.now() < deadline) {
      this.options.signal?.throwIfAborted();
      const remaining = Math.max(1, deadline - performance.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const found = await Promise.race([
        probe(),
        this.closed.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), remaining);
        }),
      ]).finally(() => clearTimeout(timer));
      this.options.signal?.throwIfAborted();
      if (found && !this.ended && !this.closing) return;
      await delay(50);
    }
    throw new AppError(this.failure || `${this.options.helper} 未在限时内就绪`, 503);
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closing = true;
    this.closeTask = Promise.resolve()
      .then(async () => {
        if (this.actual) return;
        const wait = async (ms: number) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          return Promise.race([
            this.closed.then(() => true),
            new Promise<boolean>((resolve) => {
              timer = setTimeout(() => resolve(false), ms);
            }),
          ]).finally(() => clearTimeout(timer));
        };
        if (!this.ended) this.child.kill('SIGTERM');
        if (await wait(this.options.graceMs ?? 2000)) return;
        if (!this.ended) this.child.kill('SIGKILL');
        if (await wait(this.options.closeTimeoutMs ?? 5000)) return;
        throw cleanupError();
      })
      .catch((error) => {
        this.lease.cleanupPending(error);
        this.closeTask = undefined;
        throw error;
      });
    return this.closeTask;
  }
}

export const processSupervisor = new ProcessSupervisor();
