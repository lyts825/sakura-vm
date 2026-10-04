import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { hostRuntime, resourceContext, type ResourceLease } from './host-runtime/index.ts';
import { AppError } from '../shared/errors.ts';
import { pluginAuthority, pluginCleanup } from './plugin-authority.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { captureOperationCheck } from './operation-context.ts';

const nativeSpawnAdmission = new AsyncLocalStorage<{
  active: boolean;
  lease: ResourceLease;
  adapter: HostProcessAdapter;
  created?: ObservedHostProcess;
}>();
/** Only a synchronous, already-budgeted adapter construction may call the raw launcher. */
export const spawnObserved = ((...args: unknown[]) => {
  const admission = nativeSpawnAdmission.getStore();
  if (!admission?.active || admission.created) throw new Error('Host process has no unused active admission');
  const child = Reflect.apply(spawn, undefined, args) as ChildProcess;
  admission.created = new ObservedHostProcess(child, admission.lease, admission.adapter);
  return child;
}) as typeof spawn;

export type ProcessAdmission = {
  owner: string;
  kind: 'vm' | 'tool' | 'helper';
  label: string;
  lane?: 'interactive' | 'background' | 'control';
  signal?: AbortSignal;
  queueTimeoutMs?: number;
  /** Known launch participants: a direct child or Native Host plus its target. */
  mode?: 'direct' | 'native-owner';
};
export type HelperExit = { code: number | null; signal: NodeJS.Signals | null; failure: string };
type HelperOptions = Omit<ProcessAdmission, 'kind' | 'mode'> & {
  helper: 'virtiofsd' | 'swtpm';
  file: string;
  args: string[];
  onExit?: (exit: HelperExit) => void;
  graceMs?: number;
  closeTimeoutMs?: number;
};
type SpawnHelper = (file: string, args: string[]) => ChildProcess;
export const hostProcessAdapters = {
  'windows-probe': 'tool',
  'ssh-permissions': 'tool',
  'trusted-boot-probe': 'tool',
  'virtio-fs-probe': 'tool',
  dpapi: 'tool',
  'process-interop': 'tool',
  'windows-registry': 'tool',
  'windows-user-application': 'tool',
  'clipboard-command': 'tool',
  'clipboard-launch': 'tool',
  'clipboard-descendants': 'helper',
  'gpg-discovery': 'tool',
  'gpg-asset-guard': 'helper',
  'gpg-native-relay': 'helper',
} as const;
export type HostProcessAdapter = keyof typeof hostProcessAdapters;
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
    private governor: Pick<typeof hostRuntime, 'acquire' | 'tryAcquire'> = hostRuntime,
    private spawnHelper: SpawnHelper = startHelper,
  ) {}

  private acquire(options: ProcessAdmission) {
    const instance = pluginAuthority();
    if (instance) {
      if (pluginCleanup() !== instance) instance.check('process', true);
      options = { ...options, owner: instance.owner, signal: pluginCleanup() === instance ? options.signal :
        options.signal ? AbortSignal.any([options.signal, instance.signal]) : instance.signal };
    }
    const mode = options.mode || 'direct';
    if (!['direct', 'native-owner'].includes(mode) || (mode === 'native-owner' && options.kind === 'helper'))
      throw new Error('Invalid process ownership mode');
    return this.governor.acquire({
      owner: options.owner,
      kind: 'process.' + options.kind,
      label: options.label,
      lane: options.lane || 'background',
      signal: options.signal,
      timeoutMs: options.queueTimeoutMs,
      cost: { process: mode === 'native-owner' ? 2 : 1, ['process.' + options.kind]: 1 },
    }).then(lease => {
      try { if (instance && pluginCleanup() !== instance) instance.check('process', true); }
      catch (error) { lease.release(); throw error; }
      return lease;
    });
  }

  /** A protocol adapter retains its own handshake; this observes only the actual host child. */
  async observe(
    adapter: HostProcessAdapter,
    create: () => ChildProcess,
    options: Partial<Omit<ProcessAdmission, 'kind' | 'mode'>> = {},
  ) {
    if (!Object.hasOwn(hostProcessAdapters, adapter)) throw new Error('Unknown host process adapter');
    const instance = pluginAuthority();
    if (instance && pluginCleanup() !== instance) instance.check('process', true);
    if (instance) options = { ...options, owner: instance.owner,
      signal: pluginCleanup() === instance ? options.signal : options.signal ? AbortSignal.any([options.signal, instance.signal]) : instance.signal };
    const request = {
      owner: options.owner || resourceContext()?.owner || `core:${adapter}`,
      label: adapter,
      ...options,
      kind: hostProcessAdapters[adapter],
      mode: 'direct' as const,
    };
    if (request.kind === 'helper' && request.lane !== 'control') await captureOperationCheck()();
    // A protocol guard can already own a helper when it admits a relay. Queueing another
    // helper would deadlock at capacity; fail atomically so its domain can reject/clean up.
    const lease =
      request.kind === 'helper'
        ? this.governor.tryAcquire({
            ...request,
            kind: 'process.helper',
            cost: { process: 1, 'process.helper': 1 },
          })
        : await this.acquire(request);
    if (!lease) throw new AppError('宿主辅助进程已达到资源额度', 429, 'RESOURCE_CAPACITY');
    if (instance && pluginCleanup() !== instance) {
      try { instance.check('process', true); } catch (error) { lease.release(); throw error; }
    }
    const admission: NonNullable<ReturnType<typeof nativeSpawnAdmission.getStore>> = {
      active: true,
      lease,
      adapter,
    };
    try {
      options.signal?.throwIfAborted();
      try {
        return nativeSpawnAdmission.run(admission, () => {
          const child = create();
          if (admission.created && admission.created.child !== child)
            throw new Error('Host adapter returned another process');
          return admission.created || new ObservedHostProcess(child, lease, adapter);
        });
      } finally {
        admission.active = false;
      }
    } catch (error) {
      if (admission.created) {
        // A protocol constructor can throw after spawning. Retain admission until
        // the exact child has physically closed, even though construction failed.
        admission.created.child.kill('SIGKILL');
        await admission.created.waitForClose();
      } else lease.release();
      throw error;
    }
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
    const lease = await this.acquire({ ...options, kind: 'helper', mode: 'direct' });
    try {
      options.signal?.throwIfAborted();
      return new ManagedHelper(this.spawnHelper(options.file, [...options.args]), lease, options);
    } catch (error) {
      lease.release();
      throw error;
    }
  }
}

/** EOF/abort/exit are not physical closure. A late close can retire a previously pending slot. */
export class ObservedHostProcess {
  readonly closed: Promise<HelperExit>;
  private actual?: HelperExit;
  private error?: Error;
  constructor(
    readonly child: ChildProcess,
    private lease: ResourceLease,
    private adapter: HostProcessAdapter,
  ) {
    child.on('error', (error) => {
      this.error = error;
    });
    this.closed = new Promise((resolve) =>
      child.once('close', (code, signal) => {
        this.actual = { code, signal, failure: this.error?.message || '' };
        lease.release();
        resolve(this.actual);
      }),
    );
  }
  cleanupPending(error: unknown) {
    if (!this.actual) this.lease.cleanupPending(error);
  }
  async waitForClose(timeoutMs = 5000) {
    if (this.actual) return this.actual;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(cleanupError()), timeoutMs);
        }),
      ]);
    } catch (error) {
      this.cleanupPending(error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  handoffToUser() {
    if (this.adapter !== 'windows-user-application') throw new Error('This process cannot be handed off');
    this.lease.transfer('user:desktop');
    this.lease.release();
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
