/**
 * 模块职责：绑定一次项目执行的身份、取消信号与资源预算；清理回执未确认时保留原额度。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { captureOperationCheck, withoutOperationContext } from './operation-context.ts';
import {
  hostRuntime,
  withResourceContext,
  captureResourceContext,
  type HostRuntime,
  type ResourceLease,
} from './host-runtime/index.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { vmLiveIdentity, type VmLive as Live } from './vm-reference.ts';
import { vmLifetime, type VmIdentity } from './vm-lifetime.ts';
import { vmHostIdentity } from './vm-access.ts';
import { pluginAuthority, withPluginCleanup } from './plugin-authority.ts';

export type ExecutionIdentity = Readonly<
  VmIdentity & { projectId: string; configVersion?: string; operationId: string }
>;
export type ExecutionOptions = {
  machines: Machines;
  vmId: string;
  projectId: string;
  signal: AbortSignal;
  live?: Live;
  owner?: string;
  identity?: VmIdentity;
  configVersion?: string;
  delegate?: boolean;
  governor?: Pick<HostRuntime, 'acquire'>;
};
const context = new AsyncLocalStorage<{ scope: ExecutionScope; delegate: boolean }>();
const cleanupFailed = (error: unknown): boolean =>
  error instanceof AppError &&
  error.status === 503 &&
  /(?:CLEANUP|RETIRE|UNCONFIRMED)/.test(error.code || '');
type Cleanup = {
  instance?: ReturnType<typeof pluginAuthority>;
  owner: ExecutionScope;
  work: () => Promise<void>;
  complete: boolean;
  attempted: boolean;
  task?: Promise<void>;
};

/** 一次实际操作持有一个预算；显式委派的运行器仅在同一项目调用链内借用该预算。 */
export class ExecutionScope {
  readonly identity: ExecutionIdentity;
  readonly signal: AbortSignal;
  readonly live: Live;
  readonly owner: string;
  private readonly resourceIdentity;
  private readonly lifetime;
  private readonly controller = new AbortController();
  private readonly children = new Set<Promise<unknown>>();
  private childTail: Promise<unknown> = Promise.resolve();
  private failure?: unknown;
  private finished = false;
  private activity!: ReturnType<ReturnType<typeof vmLifetime>['enter']>;
  private lease!: ResourceLease;
  private readonly root: ExecutionScope;
  private cleanups = new Set<Cleanup>();
  private cleanupErrors = new Map<unknown, Cleanup>();
  private failures = new Set<unknown>();
  private settled = false;
  private retired = false;
  private constructor(
    readonly options: ExecutionOptions,
    parent?: ExecutionScope,
  ) {
    this.root = parent?.root || this;
    if (options.machines.closing) throw new AppError('服务正在关闭', 503, 'RESOURCE_DRAINING');
    const live = options.live || options.machines.live.get(options.vmId);
    if (!live || options.machines.live.get(options.vmId) !== live)
      throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    this.live = live;
    this.lifetime = vmLifetime(options.vmId, live);
    const identity = options.identity || this.lifetime.capture();
    this.lifetime.assert(identity);
    this.identity =
      parent?.identity ||
      Object.freeze({
        ...identity,
        projectId: options.projectId,
        ...(options.configVersion ? { configVersion: options.configVersion } : {}),
        operationId: randomUUID(),
      });
    this.owner = parent?.owner || options.owner || `execution:${this.identity.operationId}`;
    this.resourceIdentity = captureResourceContext({ ...this.identity, owner: this.owner });
    this.signal = AbortSignal.any([
      options.signal,
      this.lifetime.signal,
      this.controller.signal,
      ...(parent ? [parent.signal] : []),
    ]);
  }
  assert() {
    this.signal.throwIfAborted();
    this.lifetime.assert(this.identity);
    if (this.options.machines.live.get(this.options.vmId) !== this.live)
      throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  }
  static current() {
    return context.getStore()?.scope;
  }
  /** 只向原领域所有者交付清理闭包；取消信号不能代替原资源清理成功的确认。 */
  deferCleanup(work: () => Promise<void>): () => Promise<void> {
    if (this.finished) throw new AppError('执行作用域已经结束', 409, 'EXECUTION_SCOPE_CLOSED');
    const entry: Cleanup = { owner: this, work, complete: false, attempted: false, instance: pluginAuthority() };
    this.root.cleanups.add(entry);
    return () => this.clean(entry);
  }
  private async clean(entry: Cleanup): Promise<void> {
    if (entry.complete) return;
    if (!entry.task) {
      entry.attempted = true;
      entry.task = Promise.resolve()
        .then(() => withoutOperationContext(() => entry.instance ? withPluginCleanup(entry.instance, entry.work) : entry.work()))
        .then(
          () => {
            entry.complete = true;
            this.root.tryRetire();
          },
          (cause) => {
            const error = cleanupFailed(cause)
              ? cause
              : new AppError(
                  `原执行资源清理尚未确认：${cause instanceof Error ? cause.message : String(cause)}`,
                  503,
                  'EXECUTION_CLEANUP_PENDING',
                );
            this.root.cleanupErrors.set(error, entry);
            this.root.recordFailure(error);
            throw error;
          },
        )
        .finally(() => {
          entry.task = undefined;
        });
    }
    return entry.task;
  }
  /** 领域处理器把恢复能力与完整不可变票据一起保存，防止只凭资源 ID 核销新的运行。 */
  recovery(): () => Promise<void> {
    const owner = this;
    return async () => {
      if (!owner.root.settled)
        throw new AppError('原执行尚未退出，不能并行核销', 409, 'EXECUTION_RECOVERY_ACTIVE');
      for (const entry of owner.root.cleanups) if (entry.owner === owner) await owner.clean(entry);
      owner.root.tryRetire();
    };
  }
  hasPendingCleanup() {
    return [...this.root.cleanups].some((entry) => entry.owner === this && !entry.complete);
  }
  private recordFailure(error: unknown) {
    this.root.failure ||= error;
    this.root.failures.add(error);
  }
  private tryRetire() {
    if (!this.settled || this.retired || [...this.cleanups].some((entry) => !entry.complete)) return;
    const confirmed = (error: unknown): boolean => {
      if (this.cleanupErrors.get(error)?.complete) return true;
      const errors = (error as { errors?: unknown[] } | null)?.errors;
      return Array.isArray(errors) && errors.length > 0 && errors.every(confirmed);
    };
    if (![...this.failures].every(confirmed)) return;
    // 执行退出、所有清理回执以及历史清理错误都已确认后，才交还执行和宿主额度。
    this.retired = true;
    this.activity?.release();
    this.lease.release();
  }
  private matches(options: ExecutionOptions) {
    return (
      !this.finished &&
      vmHostIdentity(this.options.machines) === vmHostIdentity(options.machines) &&
      this.identity.vmId === options.vmId &&
      this.identity.projectId === options.projectId &&
      (!options.live || vmLiveIdentity(options.live) === vmLiveIdentity(this.live)) &&
      (!options.owner || options.owner === this.owner) &&
      (!options.configVersion || this.identity.configVersion === options.configVersion)
    );
  }
  private invoke<T>(work: (scope: ExecutionScope) => Promise<T>, delegate: boolean) {
    return context.run({ scope: this, delegate }, () =>
      withResourceContext(this.resourceIdentity, () => work(this)),
    );
  }
  private borrow<T>(options: ExecutionOptions, work: (scope: ExecutionScope) => Promise<T>) {
    this.assert();
    if (this.children.size >= 64)
      throw new AppError('当前执行的子操作等待队列已满', 429, 'EXECUTION_QUEUE_FULL');
    const child = new ExecutionScope(options, this);
    const check = captureOperationCheck();
    const task = this.childTail
      .catch(() => {})
      .then(async () => {
        try {
          child.assert();
          // 子操作借用已有额度，没有再次经过宿主准入，所以进入前重查原授权。
          await check();
          child.assert();
          return await child.invoke(work, !!options.delegate);
        } catch (error) {
          child.controller.abort(error);
          throw error;
        } finally {
          child.finished = true;
          await Promise.allSettled([...child.children]);
          child.controller.abort();
          if (child.failure !== undefined) throw child.failure;
        }
      });
    this.childTail = task;
    this.children.add(task);
    void task
      .catch((error) => {
        if (cleanupFailed(error)) {
          this.failure = error;
          this.recordFailure(error);
        }
      })
      .finally(() => this.children.delete(task));
    return task;
  }
  static async run<T>(options: ExecutionOptions, work: (scope: ExecutionScope) => Promise<T>): Promise<T> {
    const parent = context.getStore();
    // 委派子操作在父额度内串行执行；若占着父额度再申请子额度，全部父操作都可能互相等待。
    if (parent) {
      if (parent.delegate && parent.scope.matches(options)) return parent.scope.borrow(options, work);
      throw new AppError('嵌套执行必须由同一项目操作显式委派', 409, 'EXECUTION_NESTING_INVALID');
    }
    const scope = new ExecutionScope(options);
    scope.lease = await (options.governor || hostRuntime).acquire({
      owner: scope.owner,
      kind: 'execution',
      label: `${options.vmId}/${options.projectId}`,
      cost: { execution: 1 },
      partitions: [
        { key: `execution:vm:${options.vmId}`, limit: 8 },
        { key: `execution:project:${options.vmId}:${options.projectId}`, limit: 4 },
      ],
      identity: scope.resourceIdentity,
      signal: scope.signal,
      timeoutMs: 60_000,
    });
    let detach = () => {};
    try {
      if (options.machines.closing) throw new AppError('服务正在关闭', 503, 'RESOURCE_DRAINING');
      scope.assert();
      scope.activity = scope.lifetime.enter(scope.identity);
      // 实例状态切换也能取消此活动，这一信号独立于用户请求本身的取消。
      const cancel = () => scope.controller.abort(scope.activity.signal.reason);
      scope.activity.signal.addEventListener('abort', cancel, { once: true });
      detach = () => scope.activity.signal.removeEventListener('abort', cancel);
      return await scope.invoke(work, !!options.delegate);
    } catch (error) {
      if (cleanupFailed(error)) {
        scope.failure = error;
        scope.recordFailure(error);
      }
      scope.controller.abort(error);
      throw error;
    } finally {
      scope.finished = true;
      scope.lease.beginCleanup?.();
      await Promise.allSettled([...scope.children]);
      for (const cleanup of scope.cleanups)
        if (!cleanup.attempted) await scope.clean(cleanup).catch(() => {});
      detach();
      scope.controller.abort();
      scope.settled = true;
      scope.tryRetire();
      if (scope.failure !== undefined) {
        if (!scope.retired) {
          scope.lease.cleanupPending(scope.failure);
          scope.activity?.cleanupPending(scope.failure);
        }
      }
      if (scope.failure !== undefined) throw scope.failure;
    }
  }
}
