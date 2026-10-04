import { AppError } from '../shared/errors.ts';
import {
  hostRuntime,
  captureResourceContext,
  type HostRuntime,
  type ResourceLease,
} from './host-runtime/index.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { vmLifetime, type VmIdentity } from './vm-lifetime.ts';
import { captureOperationCheck, withoutOperationContext } from './operation-context.ts';
import { pluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { withResourceContext } from './host-runtime/context.ts';

export type SessionReceipt = { runId: string; bootId: string; projectId: string; [key: string]: unknown };
type Options<R extends SessionReceipt> = {
  machines: Machines;
  vmId: string;
  kind: string;
  receipt: R;
  signal?: AbortSignal;
  live?: NonNullable<ReturnType<Machines['live']['get']>>;
  cleanup(receipt: R): Promise<void>;
  governor?: Pick<HostRuntime, 'tryAcquire'>;
};
const sessions = new WeakMap<Machines, Map<string, unknown>>();
const key = (vmId: string, receipt: SessionReceipt) => `${vmId}:${receipt.projectId}:${receipt.runId}`;
const incomplete = new Set(['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks', 'run']);
const same = (a: unknown, b: unknown, field = '', initialIntent = false): boolean => {
  // An initial intent may gain native identity, but an observed identity can never be erased.
  if (a === null || b === null) return a === b || ((a === null || initialIntent) && incomplete.has(field));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>,
      right = b as Record<string, unknown>;
    return (
      Object.keys(left).every(
        (name) => name === 'phase' || (name in right && same(left[name], right[name], name, initialIntent)),
      ) && Object.keys(right).every((name) => name === 'phase' || name in left)
    );
  }
  return a === b;
};

/** A running domain owns its slot until its original stop protocol confirms the whole session. */
export class ProjectSessionLifetime<R extends SessionReceipt> {
  readonly identity: VmIdentity;
  readonly signal: AbortSignal;
  private receipt: R;
  private readonly lifetime;
  private readonly live;
  private readonly controller = new AbortController();
  private lease!: ResourceLease;
  private activity!: ReturnType<ReturnType<typeof vmLifetime>['enter']>;
  private active = new Set<Promise<unknown>>();
  private closeTask?: Promise<void>;
  private closed = false;
  private removeOwned = () => {};
  private detach = () => {};
  private cleanup: (receipt: R) => Promise<void>;
  private readonly instance = pluginAuthority();
  private readonly cleanupFailures = new Set<unknown>();
  private confirmPluginCleanup: (error: unknown) => void = () => {};
  private constructor(private options: Options<R>) {
    const live = options.machines.live.get(options.vmId);
    if (!live || (options.live && options.live !== live) || options.machines.closing)
      throw new AppError('实例暂不接收常驻会话', 409, 'VM_EXECUTION_DRAINING');
    this.lifetime = vmLifetime(options.vmId, live);
    this.live = live;
    this.identity = this.lifetime.capture();
    this.receipt = structuredClone(options.receipt);
    this.cleanup = options.cleanup;
    this.signal = AbortSignal.any([
      this.controller.signal,
      this.lifetime.signal,
      ...(this.instance ? [this.instance.signal] : []),
    ]);
  }
  static async acquire<R extends SessionReceipt>(options: Options<R>): Promise<ProjectSessionLifetime<R>> {
    await captureOperationCheck()();
    const sessionKey = key(options.vmId, options.receipt);
    let registry = sessions.get(options.machines);
    if (!registry) sessions.set(options.machines, (registry = new Map()));
    const previous = registry.get(sessionKey) as ProjectSessionLifetime<R> | undefined;
    if (previous) {
      if (previous.options.kind !== options.kind)
        throw new AppError('常驻会话不属于此领域', 409, 'SESSION_ADMISSION_CONFLICT');
      previous.assertReceipt(options.receipt);
      previous.assert();
      options.signal?.throwIfAborted();
      if (options.live && options.live !== previous.live)
        throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      return previous;
    }
    const owned = new ProjectSessionLifetime(options);
    options.signal?.throwIfAborted();
    const lease = (options.governor || hostRuntime).tryAcquire({
      owner: `session:${options.receipt.runId}`,
      kind: 'execution.session',
      label: `${options.kind}:${options.receipt.projectId}`,
      identity: captureResourceContext({ ...owned.identity, projectId: options.receipt.projectId }),
      cost: { 'execution.session': 1 },
      partitions: [
        { key: `execution.session:vm:${options.vmId}`, limit: 32 },
        { key: `execution.session:project:${options.vmId}:${options.receipt.projectId}`, limit: 16 },
      ],
      signal: AbortSignal.any([owned.signal, ...(options.signal ? [options.signal] : [])]),
    });
    // Session start may hold the domain lock needed by an old session's stop. Never queue here.
    if (!lease) throw new AppError('常驻会话已达到当前资源额度', 429, 'RESOURCE_CAPACITY');
    owned.lease = lease;
    try {
      owned.assert();
      owned.activity = owned.lifetime.enter(owned.identity, { persistent: true });
      if (registry.has(sessionKey))
        throw new AppError('同一常驻会话正在启动', 409, 'SESSION_ADMISSION_CONFLICT');
      owned.removeOwned = owned.lifetime.resources.defer(
        `session:${options.receipt.runId}`,
        () => owned.close(),
        0,
      );
      registry.set(sessionKey, owned);
      const cancel = () => {
        void owned.close().catch(() => {});
      };
      owned.activity.signal.addEventListener('abort', cancel, { once: true });
      if (owned.instance) {
        owned.confirmPluginCleanup = owned.instance.scope.retainCleanup(() => owned.close());
        owned.instance.signal.addEventListener('abort', cancel, { once: true });
      }
      owned.detach = () => {
        owned.activity.signal.removeEventListener('abort', cancel);
        owned.instance?.signal.removeEventListener('abort', cancel);
      };
      return owned;
    } catch (error) {
      owned.activity?.release();
      owned.lease.release();
      throw error;
    }
  }
  assertReceipt(receipt: R, initialIntent = false) {
    if (!same(this.receipt, receipt, '', initialIntent))
      throw new AppError('常驻会话完整归属已改变', 503, 'SESSION_CLEANUP_PENDING');
  }
  pin(receipt: R) {
    this.assertReceipt(receipt);
    this.receipt = structuredClone(receipt);
  }
  private assert() {
    this.signal.throwIfAborted();
    this.lifetime.assert(this.identity);
    if (this.options.machines.live.get(this.options.vmId) !== this.live)
      throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  }
  async perform<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assert();
    if (this.active.size) throw new AppError('常驻会话正在进行另一项控制操作', 409, 'SESSION_CONTROL_BUSY');
    const active = AbortSignal.any([this.signal, ...(signal ? [signal] : [])]);
    const operation = Promise.resolve().then(() => {
      active.throwIfAborted();
      return work(active);
    });
    this.active.add(operation);
    try {
      return await operation;
    } finally {
      this.active.delete(operation);
    }
  }
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (!this.closeTask) {
      this.controller.abort();
      this.closeTask = Promise.resolve()
        .then(async () => {
          await Promise.allSettled([...this.active]);
          // Only this original domain capability can discharge the captured receipt.
          // Revoking the originating request must not revoke its cleanup authority.
          const cleanup = () =>
            withoutOperationContext(() =>
              withResourceContext(
                {
                  vmId: this.options.vmId,
                  projectId: this.receipt.projectId,
                },
                () => this.cleanup(structuredClone(this.receipt)),
              ),
            );
          await (this.instance ? withPluginCleanup(this.instance, cleanup) : cleanup());
          this.closed = true;
          this.detach();
          this.removeOwned();
          this.activity.release();
          this.lease.release();
          for (const error of this.cleanupFailures) this.confirmPluginCleanup(error);
          this.cleanupFailures.clear();
          const registry = sessions.get(this.options.machines),
            sessionKey = key(this.options.vmId, this.receipt);
          if (registry?.get(sessionKey) === this) registry.delete(sessionKey);
        })
        .catch((cause) => {
          const error =
            cause instanceof AppError && cause.status === 503
              ? cause
              : new AppError(
                  `常驻会话清理尚未确认：${cause instanceof Error ? cause.message : String(cause)}`,
                  503,
                  'SESSION_CLEANUP_PENDING',
                );
          this.lease.cleanupPending(error);
          this.activity.cleanupPending(error);
          this.cleanupFailures.add(error);
          this.closeTask = undefined;
          throw error;
        });
      this.instance?.scope.observe(this.closeTask);
    }
    return this.closeTask;
  }
  /** Domain code supplies a freshly verified full receipt and its native stop protocol, never an ID-only release. */
  static async retire<R extends SessionReceipt>(
    machines: Machines,
    vmId: string,
    receipt: R,
    cleanup: (receipt: R) => Promise<void>,
  ): Promise<void> {
    const owned = sessions.get(machines)?.get(key(vmId, receipt)) as ProjectSessionLifetime<R> | undefined;
    if (!owned) return cleanup(receipt);
    // Startup rollback can still hold the original intent after a lost acknowledgement. It may
    // request cleanup, but the native handler receives our fuller pinned receipt, never that intent.
    owned.assertReceipt(receipt, true);
    owned.cleanup = cleanup;
    await owned.close();
  }
  /** Reloaded domain handlers may request the original owner, including its preparation children. */
  static async retireOriginal<R extends SessionReceipt>(
    machines: Machines,
    vmId: string,
    receipt: R,
    fallback: () => Promise<void>,
  ): Promise<void> {
    const owned = sessions.get(machines)?.get(key(vmId, receipt)) as ProjectSessionLifetime<R> | undefined;
    if (!owned) return fallback();
    owned.assertReceipt(receipt, true);
    await owned.close();
  }
}
