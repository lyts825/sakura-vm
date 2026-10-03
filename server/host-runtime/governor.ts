import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/errors.ts';
import type {
  HostRuntimeView,
  ResourceIdentity,
  ResourceLane,
  ResourceView,
} from '../../shared/contracts/host-runtime.ts';
import { captureResourceContext } from './context.ts';
import { captureOperationCheck } from '../operation-context.ts';

export type Budget = { capacity: number; reserved?: number };
export type ResourceRequest = {
  owner: string;
  kind: string;
  label: string;
  lane?: ResourceLane;
  cost: Record<string, number>;
  /** Partitions are acquired together with global costs, never by holding another semaphore. */
  partitions?: { key: string; limit: number; amount?: number }[];
  identity?: Partial<ResourceIdentity>;
  signal?: AbortSignal;
  timeoutMs?: number;
  onQueued?: (id: string) => void;
};
export type ResourceRegistration = Pick<ResourceRequest, 'owner' | 'kind' | 'label' | 'lane' | 'identity'>;
export type ResourceLease = {
  readonly id: string;
  release(): void;
  cleanupPending(error: unknown): void;
  transfer(owner: string): void;
  /** Atomically adjust held dimensions without waiting or adding another resource. */
  resize(cost: Record<string, number>): void;
};
type Dimension = { capacity: number; reserved: number; used: number; references: number; partition: boolean };
type Request = {
  view: ResourceView;
  dimensions: Map<string, number>;
  signal?: AbortSignal;
  removeAbort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (lease: ResourceLease) => void;
  reject: (error: unknown) => void;
  queuedAt: number;
};

export const HOST_BUDGETS: Readonly<Record<string, Budget>> = Object.freeze({
  process: { capacity: 32, reserved: 4 },
  'process.vm': { capacity: 4 },
  'process.tool': { capacity: 4, reserved: 1 },
  'process.helper': { capacity: 16, reserved: 2 },
  jobs: { capacity: 16, reserved: 2 },
  execution: { capacity: 16, reserved: 2 },
  'execution.session': { capacity: 64, reserved: 4 },
  io: { capacity: 8, reserved: 2 },
  'io.buffers': { capacity: 64 * 1024 * 1024, reserved: 4 * 1024 * 1024 },
  'io.files': { capacity: 128, reserved: 8 },
  'network.worker': { capacity: 8 },
  'compute.worker': { capacity: 4 },
  'compute.memory': { capacity: 512 * 1024 ** 2, reserved: 32 * 1024 ** 2 },
});

function identifier(value: string, name: string) {
  if (typeof value !== 'string' || !value.length || value.length > 200 || /[\x00-\x1f\x7f]/.test(value))
    throw new AppError(`无效的资源${name}`, 400, 'RESOURCE_INVALID');
  return value;
}
function count(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new AppError(`无效的资源额度：${name}`, 400, 'RESOURCE_INVALID');
  return value;
}
function failure(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

/** One atomic admission point for host resources; domain locks remain with their owners. */
export class HostRuntime {
  private state: HostRuntimeView['state'] = 'accepting';
  private dimensions = new Map<string, Dimension>();
  private resources = new Map<string, ResourceView>();
  private recent: ResourceView[] = [];
  private waiting: Request[] = [];
  private lastOwner?: string;
  private pumping = false;
  private totals = { admitted: 0, rejected: 0, cancelled: 0, released: 0 };
  private readonly queueLimit: number;
  private readonly ownerQueueLimit: number;
  private readonly controlQueueReserve: number;
  private readonly registryLimit: number;
  constructor(
    options: {
      budgets?: Record<string, Budget>;
      queueLimit?: number;
      ownerQueueLimit?: number;
      controlQueueReserve?: number;
      registryLimit?: number;
    } = {},
  ) {
    for (const [key, value] of Object.entries(options.budgets ?? HOST_BUDGETS)) {
      identifier(key, '类型');
      const capacity = count(value.capacity, key),
        reserved = value.reserved ?? 0;
      if (!Number.isSafeInteger(reserved) || reserved < 0 || reserved >= capacity)
        throw new Error(`Invalid reserved budget: ${key}`);
      this.dimensions.set(key, { capacity, reserved, used: 0, references: 0, partition: false });
    }
    this.queueLimit = count(options.queueLimit ?? 256, 'queue');
    this.ownerQueueLimit = count(options.ownerQueueLimit ?? 64, 'owner queue');
    this.controlQueueReserve = Math.min(options.controlQueueReserve ?? 16, this.queueLimit - 1);
    if (!Number.isSafeInteger(this.controlQueueReserve) || this.controlQueueReserve < 0)
      throw new Error('Invalid control queue reserve');
    this.registryLimit = count(options.registryLimit ?? 8192, 'registry');
  }

  private createView(
    request: ResourceRegistration,
    state: ResourceView['state'],
    cost: Record<string, number>,
  ) {
    if (this.state === 'closed' || (this.state === 'draining' && request.lane !== 'control'))
      throw new AppError('系统正在关闭，暂不接收新资源', 503, 'RESOURCE_DRAINING');
    if (this.resources.size >= this.registryLimit)
      throw new AppError('资源登记已达到上限', 503, 'RESOURCE_REGISTRY_FULL');
    const owner = identifier(request.owner, '所有者');
    const lane = request.lane ?? 'interactive';
    if (!['interactive', 'background', 'control'].includes(lane)) throw new Error('Invalid resource lane');
    const view: ResourceView = {
      id: randomUUID(),
      owner,
      kind: identifier(request.kind, '种类'),
      label: identifier(request.label, '名称'),
      lane,
      state,
      cost: { ...cost },
      identity: { ...captureResourceContext({ ...request.identity, owner }) },
      createdAt: new Date().toISOString(),
    };
    this.resources.set(view.id, view);
    return view;
  }

  register(request: ResourceRegistration): ResourceLease {
    const view = this.createView(request, 'active', {});
    view.admittedAt = view.createdAt;
    ++this.totals.admitted;
    return this.lease(view, new Map());
  }

  private prepare(input: ResourceRequest) {
    input.signal?.throwIfAborted();
    const timeoutMs = input.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 24 * 60 * 60 * 1000)
      throw new AppError('资源等待期限无效', 400, 'RESOURCE_INVALID');
    const dimensions = new Map<string, number>();
    const partitions = new Map<string, number>();
    if ((input.partitions?.length ?? 0) > 32)
      throw new AppError('资源分区数量超过上限', 400, 'RESOURCE_INVALID');
    for (const [key, amount] of Object.entries(input.cost)) {
      const dimension = this.dimensions.get(key);
      if (!dimension || dimension.partition)
        throw new AppError(`未知的资源额度：${key}`, 400, 'RESOURCE_INVALID');
      count(amount, key);
      const limit = dimension.capacity - (input.lane === 'control' ? 0 : dimension.reserved);
      if (amount > limit) throw new AppError(`资源申请超过单项上限：${key}`, 429, 'RESOURCE_CAPACITY');
      dimensions.set(key, amount);
    }
    for (const partition of input.partitions ?? []) {
      const key = 'partition:' + identifier(partition.key, '分区');
      if (partitions.has(key)) throw new AppError('重复的资源分区', 400, 'RESOURCE_INVALID');
      const capacity = count(partition.limit, key),
        amount = count(partition.amount ?? 1, key);
      if (amount > capacity) throw new AppError(`资源申请超过分区上限：${key}`, 429, 'RESOURCE_CAPACITY');
      const existing = this.dimensions.get(key);
      if (existing && existing.capacity !== capacity)
        throw new AppError(`资源分区额度不一致：${key}`, 409, 'RESOURCE_PARTITION_CONFLICT');
      partitions.set(key, capacity);
      dimensions.set(key, amount);
    }
    if (!dimensions.size) throw new AppError('资源申请必须声明预算', 400, 'RESOURCE_INVALID');
    return { dimensions, partitions, timeoutMs };
  }

  /** Never jumps ahead of a queued caller. Failure creates no registry/partition state. */
  tryAcquire(input: ResourceRequest): ResourceLease | undefined {
    const { dimensions, partitions } = this.prepare(input);
    if (this.state === 'closed' || (this.state === 'draining' && input.lane !== 'control'))
      throw new AppError('系统正在关闭，暂不接收新资源', 503, 'RESOURCE_DRAINING');
    identifier(input.owner, '所有者');
    identifier(input.kind, '种类');
    identifier(input.label, '名称');
    if (!['interactive', 'background', 'control'].includes(input.lane ?? 'interactive'))
      throw new Error('Invalid resource lane');
    if (
      this.waiting.length ||
      [...dimensions].some(([key, amount]) => {
        const existing = this.dimensions.get(key);
        return existing
          ? existing.used + amount > existing.capacity - (input.lane === 'control' ? 0 : existing.reserved)
          : amount > partitions.get(key)!;
      })
    )
      return undefined;
    const view = this.createView(input, 'active', Object.fromEntries(dimensions));
    for (const [key, capacity] of partitions)
      if (!this.dimensions.has(key))
        this.dimensions.set(key, { capacity, reserved: 0, used: 0, references: 0, partition: true });
    for (const [key, amount] of dimensions) {
      const dimension = this.dimensions.get(key)!;
      dimension.references++;
      dimension.used += amount;
    }
    view.admittedAt = new Date().toISOString();
    this.lastOwner = view.owner;
    this.totals.admitted++;
    return this.lease(view, dimensions);
  }

  acquire(input: ResourceRequest): Promise<ResourceLease> {
    const check = captureOperationCheck();
    try {
      const { dimensions, partitions, timeoutMs } = this.prepare(input);
      const view = this.createView(input, 'queued', Object.fromEntries(dimensions));
      for (const [key, capacity] of partitions)
        if (!this.dimensions.has(key))
          this.dimensions.set(key, { capacity, reserved: 0, used: 0, references: 0, partition: true });
      for (const key of dimensions.keys()) ++this.dimensions.get(key)!.references;
      return new Promise<ResourceLease>((resolve, reject) => {
        const request: Request = {
          view,
          dimensions,
          resolve,
          reject,
          signal: input.signal,
          queuedAt: performance.now(),
        };
        // Preserve already queued owners' turns. Requests on independent budgets can still proceed.
        if (!this.waiting.length && this.fits(request)) {
          this.admit(request);
          return;
        }
        const queueCapacity = this.queueLimit - (view.lane === 'control' ? 0 : this.controlQueueReserve);
        if (
          this.waiting.length >= queueCapacity ||
          this.waiting.filter((item) => item.view.owner === view.owner).length >= this.ownerQueueLimit
        ) {
          this.reject(request, new AppError('资源等待队列已满，请稍后重试', 429, 'RESOURCE_QUEUE_FULL'));
          return;
        }
        this.waiting.push(request);
        const cancelled = () => {
          ++this.totals.cancelled;
          this.reject(request, input.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
          this.pump();
        };
        input.signal?.addEventListener('abort', cancelled, { once: true });
        request.removeAbort = () => input.signal?.removeEventListener('abort', cancelled);
        request.timer = setTimeout(() => {
          this.reject(request, new AppError('等待资源超时', 503, 'RESOURCE_WAIT_TIMEOUT'));
          this.pump();
        }, timeoutMs);
        // A caller awaiting admission keeps the host alive until it receives a lease or failure.
        try {
          input.onQueued?.(view.id);
        } catch (error) {
          this.reject(request, error);
        }
        if (input.signal?.aborted && this.resources.has(view.id)) cancelled();
        this.pump();
      }).then(async (lease) => {
        try {
          // Queue admission is not authorization. Recheck the original operation
          // before handing its owner any usable resource; cleanup keeps its lane.
          if (input.lane !== 'control') await check();
          input.signal?.throwIfAborted();
          return lease;
        } catch (error) {
          lease.release();
          throw error;
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private fits(request: Request) {
    return [...request.dimensions].every(([key, amount]) => {
      const dimension = this.dimensions.get(key)!;
      return (
        dimension.used + amount <=
        dimension.capacity - (request.view.lane === 'control' ? 0 : dimension.reserved)
      );
    });
  }
  private unqueue(request: Request) {
    const index = this.waiting.indexOf(request);
    if (index >= 0) this.waiting.splice(index, 1);
    clearTimeout(request.timer);
    request.removeAbort?.();
  }
  private releaseReferences(dimensions: Map<string, number>) {
    for (const key of dimensions.keys()) {
      const dimension = this.dimensions.get(key)!;
      --dimension.references;
      if (dimension.partition && !dimension.references && !dimension.used) this.dimensions.delete(key);
    }
  }
  private finish(view: ResourceView, state: 'released' | 'rejected') {
    view.state = state;
    view.finishedAt = new Date().toISOString();
    this.resources.delete(view.id);
    this.recent.push(view);
    if (this.recent.length > 200) this.recent.shift();
  }
  private reject(request: Request, error: unknown) {
    if (request.view.state !== 'queued') return;
    this.unqueue(request);
    this.releaseReferences(request.dimensions);
    request.view.error = failure(error);
    this.finish(request.view, 'rejected');
    ++this.totals.rejected;
    request.reject(error);
  }
  private admit(request: Request) {
    this.unqueue(request);
    if (request.signal?.aborted) {
      this.reject(request, request.signal.reason);
      return;
    }
    for (const [key, amount] of request.dimensions) this.dimensions.get(key)!.used += amount;
    request.view.state = 'active';
    request.view.admittedAt = new Date().toISOString();
    this.lastOwner = request.view.owner;
    ++this.totals.admitted;
    request.resolve(this.lease(request.view, request.dimensions));
  }
  private lease(view: ResourceView, dimensions: Map<string, number>): ResourceLease {
    let released = false;
    return {
      id: view.id,
      resize: (cost) => {
        if (released) throw new AppError('已释放资源不能调整预算', 409, 'RESOURCE_RELEASED');
        if (view.state !== 'active')
          throw new AppError('待清理资源不能调整预算', 409, 'RESOURCE_CLEANUP_PENDING');
        const changes = Object.entries(cost);
        // Validate every dimension before mutating any of them. Never queue while
        // the caller holds the resources needed to finish or clean up this work.
        for (const [key, amount] of changes) {
          if (!dimensions.has(key) || !Number.isSafeInteger(amount) || amount < 0)
            throw new AppError(`无效的资源预算调整：${key}`, 400, 'RESOURCE_INVALID');
          const dimension = this.dimensions.get(key)!;
          const limit = dimension.capacity - (view.lane === 'control' ? 0 : dimension.reserved);
          if (amount > dimensions.get(key)! && dimension.used - dimensions.get(key)! + amount > limit)
            throw new AppError(`资源预算不足：${key}`, 429, 'RESOURCE_CAPACITY');
        }
        let decreased = false;
        for (const [key, amount] of changes) {
          const previous = dimensions.get(key)!;
          this.dimensions.get(key)!.used += amount - previous;
          dimensions.set(key, amount);
          view.cost[key] = amount;
          decreased ||= amount < previous;
        }
        // Keep references for zero-cost partitions until the lease is released.
        if (decreased) this.pump();
      },
      release: () => {
        if (released) return;
        released = true;
        for (const [key, amount] of dimensions) this.dimensions.get(key)!.used -= amount;
        this.releaseReferences(dimensions);
        this.finish(view, 'released');
        ++this.totals.released;
        this.pump();
      },
      cleanupPending: (error) => {
        if (released) return;
        view.state = 'cleanup-pending';
        view.error = failure(error);
      },
      transfer: (owner) => {
        if (released) throw new AppError('已释放资源不能移交', 409, 'RESOURCE_RELEASED');
        identifier(owner, '所有者');
        view.previousOwner = view.owner;
        view.owner = owner;
        view.identity = { ...view.identity, owner };
      },
    };
  }
  private pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const now = performance.now();
        const eligible = this.waiting.filter((request) => this.fits(request));
        if (!eligible.length) break;
        const priority = (request: Request) =>
          request.view.lane === 'control'
            ? 2
            : request.view.lane === 'interactive' || now - request.queuedAt >= 2000
              ? 1
              : 0;
        const highest = Math.max(...eligible.map(priority));
        const peers = eligible.filter((request) => priority(request) === highest);
        const next = peers.find((request) => request.view.owner !== this.lastOwner) ?? peers[0];
        this.admit(next);
      }
    } finally {
      this.pumping = false;
    }
  }

  beginDrain() {
    if (this.state !== 'accepting') return;
    this.state = 'draining';
    for (const request of [...this.waiting])
      if (request.view.lane !== 'control')
        this.reject(request, new AppError('系统正在关闭', 503, 'RESOURCE_DRAINING'));
  }
  /** Called after domain owners finish their cleanup. A failure must remain inspectable. */
  close() {
    this.beginDrain();
    for (const request of [...this.waiting])
      this.reject(request, new AppError('系统已关闭', 503, 'RESOURCE_DRAINING'));
    if (this.resources.size)
      throw new AppError(`仍有 ${this.resources.size} 项资源未确认释放`, 503, 'RESOURCE_CLEANUP_PENDING');
    this.state = 'closed';
  }
  snapshot(): HostRuntimeView {
    return {
      state: this.state,
      budgets: [...this.dimensions].map(([key, value]) => ({
        key,
        capacity: value.capacity,
        reserved: value.reserved,
        used: value.used,
      })),
      resources: [...this.resources.values()].map((view) => structuredClone(view)),
      recent: this.recent.map((view) => structuredClone(view)),
      queued: this.waiting.length,
      totals: { ...this.totals },
    };
  }
}
