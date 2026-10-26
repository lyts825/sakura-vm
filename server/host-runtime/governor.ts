/**
 * 模块职责：统一管理宿主资源预算、等待队列与租约；未确认清理的资源继续占用额度。
 * Module purpose: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
 */
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
import { runtimeTimings } from '../runtime-timings.ts';

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
  /**
   * 签名 / Signature: ResourceRequest.onQueued.
   * 功能：为统一管理宿主资源预算、等待队列与租约声明 onQueued 的输入与结果契约，所属容器为 ResourceRequest。
   * Purpose: Declares the input/result contract for onQueued in ResourceRequest. Module responsibility: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 输入 / Inputs: id: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  onQueued?: (id: string) => void;
};
export type ResourceRegistration = Pick<ResourceRequest, 'owner' | 'kind' | 'label' | 'lane' | 'identity'>;
export type ResourceLease = {
  readonly id: string;
  /**
   * 签名 / Signature: ResourceLease.release.
   * 功能：为统一管理宿主资源预算、等待队列与租约声明 release 的输入与结果契约，所属容器为 ResourceLease。
   * Purpose: Declares the input/result contract for release in ResourceLease. Module responsibility: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  release(): void;
  /** Internal lifecycle instrumentation; does not change admission or resource ownership. */
  /**
   * 签名 / Signature: ResourceLease.beginCleanup.
   * 功能：为统一管理宿主资源预算、等待队列与租约声明 beginCleanup 的输入与结果契约，所属容器为 ResourceLease。
   * Purpose: Declares the input/result contract for beginCleanup in ResourceLease. Module responsibility: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  beginCleanup?(): void;
  /**
   * 签名 / Signature: ResourceLease.cleanupPending.
   * 功能：为统一管理宿主资源预算、等待队列与租约声明 cleanupPending 的输入与结果契约，所属容器为 ResourceLease。
   * Purpose: Declares the input/result contract for cleanupPending in ResourceLease. Module responsibility: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 输入 / Inputs: error: unknown
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  cleanupPending(error: unknown): void;
  /**
   * 签名 / Signature: ResourceLease.transfer.
   * 功能：为统一管理宿主资源预算、等待队列与租约声明 transfer 的输入与结果契约，所属容器为 ResourceLease。
   * Purpose: Declares the input/result contract for transfer in ResourceLease. Module responsibility: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 输入 / Inputs: owner: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  transfer(owner: string): void;
  /** Atomically adjust held dimensions without waiting or adding another resource. */
  /**
   * 签名 / Signature: ResourceLease.resize.
   * 功能：为统一管理宿主资源预算、等待队列与租约声明 resize 的输入与结果契约，所属容器为 ResourceLease。
   * Purpose: Declares the input/result contract for resize in ResourceLease. Module responsibility: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 输入 / Inputs: cost: Record<string, number>
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  resize(cost: Record<string, number>): void;
};
type Dimension = { capacity: number; reserved: number; used: number; references: number; partition: boolean };
type Request = {
  view: ResourceView;
  dimensions: Map<string, number>;
  signal?: AbortSignal;
  /**
   * 签名 / Signature: Request.removeAbort.
   * 功能：为统一管理宿主资源预算、等待队列与租约声明 removeAbort 的输入与结果契约，所属容器为 Request。
   * Purpose: Declares the input/result contract for removeAbort in Request. Module responsibility: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  removeAbort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  /**
   * 签名 / Signature: Request.resolve.
   * 功能：为统一管理宿主资源预算、等待队列与租约声明 resolve 的输入与结果契约，所属容器为 Request。
   * Purpose: Declares the input/result contract for resolve in Request. Module responsibility: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 输入 / Inputs: lease: ResourceLease
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  resolve: (lease: ResourceLease) => void;
  /**
   * 签名 / Signature: Request.reject.
   * 功能：为统一管理宿主资源预算、等待队列与租约声明 reject 的输入与结果契约，所属容器为 Request。
   * Purpose: Declares the input/result contract for reject in Request. Module responsibility: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 输入 / Inputs: error: unknown
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
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
  'native.memory': { capacity: 2 * 1024 ** 3 },
});

/**
 * 入口 / Entry: identifier.
 * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` 供上层消费（`host-runtime/governor.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-runtime/governor.ts`; this entry produces `value` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
 * 处理：通过 `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string; name: string
 * 输出 / Returns: `value`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `typeof value !== 'string' || !value.length || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)`; 异常 / errors `new AppError(`无效的资源${name}`, 400, 'RESOURCE_INVALID')`.
 */
function identifier(value: string, name: string) {
  if (typeof value !== 'string' || !value.length || value.length > 200 || /[\x00-\x1f\x7f]/.test(value))
    throw new AppError(`无效的资源${name}`, 400, 'RESOURCE_INVALID');
  return value;
}
/**
 * 入口 / Entry: count.
 * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` 供上层消费（`host-runtime/governor.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-runtime/governor.ts`; this entry produces `value` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
 * 输入 / Inputs: value: number; name: string
 * 输出 / Returns: `value`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(value) || value < 1`; 异常 / errors `new AppError(`无效的资源额度：${name}`, 400, 'RESOURCE_INVALID')`.
 */
function count(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new AppError(`无效的资源额度：${name}`, 400, 'RESOURCE_INVALID');
  return value;
}
/**
 * 入口 / Entry: failure.
 * 功能：从当前输入或状态计算 `(error instanceof Error ? error.message : String(error)).slice(0, 512)`，供调用方后续验证或使用。
 * Purpose: Computes `(error instanceof Error ? error.message : String(error)).slice(0, 512)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: `(error instanceof Error ? error.message : String(error)).slice(0, 512)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
  private cleanupListeners = new Set<
  /**
   * 中文功能：为 HostRuntime.cleanupListeners 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
   * English: Registers event/state-change/phase-completion notification for HostRuntime.cleanupListeners using its declared event data.
   * 所属 / Owner: HostRuntime.cleanupListeners.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void>();
  /**
   * 入口 / Entry: HostRuntime.subscribeCleanup.
   * 功能：从当前输入或状态计算 `() => { this.cleanupListeners.delete(listener); }`，供调用方后续验证或使用。
   * Purpose: Computes `() => { this.cleanupListeners.delete(listener); }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: listener: () => void
   * 输出 / Returns: `() => { this.cleanupListeners.delete(listener); }`.
   * 副作用 / Effects: `this.cleanupListeners.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  subscribeCleanup(listener: () => void) {
    this.cleanupListeners.add(listener);
    return () => { this.cleanupListeners.delete(listener); };
  }
  private clocks = new WeakMap<ResourceView, { created: number; admitted?: number; cleanup?: number }>();
  private timings = {
    queue: { count: 0, totalMs: 0, maxMs: 0 },
    execution: { count: 0, totalMs: 0, maxMs: 0 },
    cleanup: { count: 0, totalMs: 0, maxMs: 0 },
  };
  /**
   * 入口 / Entry: HostRuntime.elapsed.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ queueMs: Math.max(0, (clock.admitted ?? now) - clock.created), lifetimeMs: clock.admitted === undefined ? 0 : Math.max(0, n…` 供上层消费（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; this entry produces `{ queueMs: Math.max(0, (clock.admitted ?? now) - clock.created), lifetimeMs: clock.admitted === undefined ? 0 : Math.max(0, n…` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `this.clocks.get`, `performance.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.clocks.get`, `performance.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: view: ResourceView
   * 输出 / Returns: `{ queueMs: Math.max(0, (clock.admitted ?? now) - clock.created), lifetimeMs: clock.admitted === undefined ? 0 : Math.max(0, n…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private elapsed(view: ResourceView) {
    const clock = this.clocks.get(view)!;
    const now = performance.now();
    return { queueMs: Math.max(0, (clock.admitted ?? now) - clock.created),
      lifetimeMs: clock.admitted === undefined ? 0 : Math.max(0, now - clock.admitted),
      // Kept for V1 consumers; this historical field measures held-resource time, not task work.
      executionMs: clock.admitted === undefined ? 0 : Math.max(0, (clock.cleanup ?? now) - clock.admitted),
      cleanupMs: clock.cleanup === undefined ? 0 : Math.max(0, now - clock.cleanup) };
  }
  private readonly queueLimit: number;
  private readonly ownerQueueLimit: number;
  private readonly controlQueueReserve: number;
  private readonly registryLimit: number;
  /**
   * 入口 / Entry: HostRuntime.constructor.
   * 功能：建立 HostRuntime 的统一管理宿主资源预算、等待队列与租约上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HostRuntime context for this module's responsibility: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: options: { budgets?: Record<string, Budget>; queueLimit?: number; ownerQueueLimit?: number; co… default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `this.dimensions.set`; 更新 / updates `this.queueLimit`, `this.ownerQueueLimit`, `this.controlQueueReserve`, `this.registryLimit`.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(reserved) || reserved < 0 || reserved >= capacity`; `!Number.isSafeInteger(this.controlQueueReserve) || this.controlQueueReserve < 0`; 异常 / errors `new Error(`Invalid reserved budget: ${key}`)`; `new Error('Invalid control queue reserve')`.
   */
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

  /**
   * 入口 / Entry: HostRuntime.createView.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `view` 供上层消费（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; this entry produces `view` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `identifier`, `inline.includes`, `randomUUID`, `captureResourceContext` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `identifier`, `inline.includes`, `randomUUID`, `captureResourceContext`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: request: ResourceRegistration; state: ResourceView['state']; cost: Record<string, number>
   * 输出 / Returns: `view`.
   * 副作用 / Effects: `this.resources.set`; `this.clocks.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.state === 'closed' || (this.state === 'draining' && request.lane !== 'control')`; `this.resources.size >= this.registryLimit`; `!['interactive', 'background', 'control'].includes(lane)`; 异常 / errors `new AppError('系统正在关闭，暂不接收新资源', 503, 'RESOURCE_DRAINING')`; `new AppError('资源登记已达到上限', 503, 'RESOURCE_REGISTRY_FULL')`.
   */
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
    this.clocks.set(view, { created: performance.now(), ...(state === 'active' ? { admitted: performance.now() } : {}) });
    return view;
  }

  /**
   * 入口 / Entry: HostRuntime.register.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.lease(view, new Map())` 供上层消费（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; this entry produces `this.lease(view, new Map())` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `this.createView`, `this.lease` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.createView`, `this.lease`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: request: ResourceRegistration
   * 输出 / Returns: ResourceLease；结果来自 / values from `this.lease(view, new Map())`.
   * 副作用 / Effects: `this.createView`; 更新 / updates `view.admittedAt`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  register(request: ResourceRegistration): ResourceLease {
    const view = this.createView(request, 'active', {});
    view.admittedAt = view.createdAt;
    ++this.totals.admitted;
    return this.lease(view, new Map());
  }

  /**
   * 入口 / Entry: HostRuntime.prepare.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ dimensions, partitions, timeoutMs }` 供上层消费（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; this entry produces `{ dimensions, partitions, timeoutMs }` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `input.signal.throwIfAborted`, `this.dimensions.get`, `count`, `dimensions.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `input.signal.throwIfAborted`, `this.dimensions.get`, `count`, `dimensions.set`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: ResourceRequest
   * 输出 / Returns: `{ dimensions, partitions, timeoutMs }`.
   * 副作用 / Effects: `dimensions.set`; `partitions.set`.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 24 * 60 * 60 * 1000`; `(input.partitions?.length ?? 0) > 32`; `!dimension || dimension.partition`; 异常 / errors `new AppError('资源等待期限无效', 400, 'RESOURCE_INVALID')`; `new AppError('资源分区数量超过上限', 400, 'RESOURCE_INVALID')`.
   */
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
  /**
   * 入口 / Entry: HostRuntime.tryAcquire.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `undefined` / `this.lease(view, dimensions)` 供上层消费（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; this entry produces `undefined` / `this.lease(view, dimensions)` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `this.prepare`, `identifier`, `inline.includes`, `inline.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.prepare`, `identifier`, `inline.includes`, `inline.some`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.waiting.length || [...dimensions].some(([key, amount]) => { const existing = this.dimensions.ge…`; `!this.dimensions.has(key)`.
   * 输入 / Inputs: input: ResourceRequest
   * 输出 / Returns: ResourceLease | undefined；结果来自 / values from `undefined`; `this.lease(view, dimensions)`.
   * 副作用 / Effects: `this.createView`; `this.dimensions.set`; 更新 / updates `dimension.used`, `view.admittedAt`, `this.lastOwner`.
   * 拒绝 / Refusals: 条件 / conditions `this.state === 'closed' || (this.state === 'draining' && input.lane !== 'control')`; `!['interactive', 'background', 'control'].includes(input.lane ?? 'interactive')`; 异常 / errors `new AppError('系统正在关闭，暂不接收新资源', 503, 'RESOURCE_DRAINING')`; `new Error('Invalid resource lane')`.
   */
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

  /**
   * 入口 / Entry: HostRuntime.acquire.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new Promise<ResourceLease>((resolve, reject) => { const request: Request = { view, dimensions, resolve, reject, signal: input…` / `Promise.reject(error)` 供上层消费（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; this entry produces `new Promise<ResourceLease>((resolve, reject) => { const request: Request = { view, dimensions, resolve, reject, signal: input…` / `Promise.reject(error)` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `captureOperationCheck`, `this.prepare`, `this.createView`, `this.dimensions.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `captureOperationCheck`, `this.prepare`, `this.createView`, `this.dimensions.has`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.dimensions.has(key)`.
   * 输入 / Inputs: input: ResourceRequest
   * 输出 / Returns: Promise<ResourceLease>；结果来自 / values from `new Promise<ResourceLease>((resolve, reject) => { const request: Request = { view, dimensions, resolve, reject, signal: input…`; `Promise.reject(error)`.
   * 副作用 / Effects: `this.createView`; `this.dimensions.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return Promise.reject(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return Promise.reject(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  acquire(input: ResourceRequest): Promise<ResourceLease> {
    const check = captureOperationCheck();
    try {
      const { dimensions, partitions, timeoutMs } = this.prepare(input);
      const view = this.createView(input, 'queued', Object.fromEntries(dimensions));
      for (const [key, capacity] of partitions)
        if (!this.dimensions.has(key))
          this.dimensions.set(key, { capacity, reserved: 0, used: 0, references: 0, partition: true });
      for (const key of dimensions.keys()) ++this.dimensions.get(key)!.references;
      /**
       * 入口 / Entry: HostRuntime.acquire.callback@297.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.then).
       * 输入 / Inputs: lease
       * 输出 / Returns: `lease`.
       * 副作用 / Effects: `lease.release`.
       * 拒绝 / Refusals: 异常 / errors `error`.
       * 失败处理：catch 分支执行 `lease.release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `lease.release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
       */
      /**
       * 入口 / Entry: HostRuntime.acquire.callback@255.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.then).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `this.waiting.push`; `input.signal.addEventListener`; `setTimeout`; 更新 / updates `request.removeAbort`, `request.timer`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       * 失败处理：catch 分支执行 `this.reject(request, error);`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `this.reject(request, error);`; these statements determine whether a failure is absorbed or rejected again.
       */
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
        /**
         * 入口 / Entry: HostRuntime.acquire.cancelled.
         * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostRuntime`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; the calls and state transitions below complete the operation. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
         * 处理：通过 `this.reject`, `this.pump` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.reject`, `this.pump`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const cancelled = () => {
          ++this.totals.cancelled;
          this.reject(request, input.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
          this.pump();
        };
        input.signal?.addEventListener('abort', cancelled, { once: true });
        /**
         * 入口 / Entry: HostRuntime.acquire.request.removeAbort.
         * 功能：把本层请求转交 `input.signal.removeEventListener`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `input.signal.removeEventListener` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `input.signal?.removeEventListener('abort', cancelled)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
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

  /**
   * 入口 / Entry: HostRuntime.fits.
   * 功能：从当前输入或状态计算 `[...request.dimensions].every(([key, amount]) => { const dimension = this.dimensions.get(key)!; return ( dimension.used + amo…`，供调用方后续验证或使用。
   * Purpose: Computes `[...request.dimensions].every(([key, amount]) => { const dimension = this.dimensions.get(key)!; return ( dimension.used + amo…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: request: Request
   * 输出 / Returns: `[...request.dimensions].every(([key, amount]) => { const dimension = this.dimensions.get(key)!; return ( dimension.used + amo…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private fits(request: Request) {
    return [...request.dimensions].every(([key, amount]) => {
      const dimension = this.dimensions.get(key)!;
      return (
        dimension.used + amount <=
        dimension.capacity - (request.view.lane === 'control' ? 0 : dimension.reserved)
      );
    });
  }
  /**
   * 入口 / Entry: HostRuntime.unqueue.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; the calls and state transitions below complete the operation. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `this.waiting.indexOf`, `this.waiting.splice`, `clearTimeout`, `request.removeAbort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.waiting.indexOf`, `this.waiting.splice`, `clearTimeout`, `request.removeAbort`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `index >= 0`.
   * 输入 / Inputs: request: Request
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.waiting.splice`; `clearTimeout`; `request.removeAbort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private unqueue(request: Request) {
    const index = this.waiting.indexOf(request);
    if (index >= 0) this.waiting.splice(index, 1);
    clearTimeout(request.timer);
    request.removeAbort?.();
  }
  /**
   * 入口 / Entry: HostRuntime.releaseReferences.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`HostRuntime`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostRuntime`; the calls and state transitions below complete the operation. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `dimensions.keys`, `this.dimensions.get`, `this.dimensions.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `dimensions.keys`, `this.dimensions.get`, `this.dimensions.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `dimension.partition && !dimension.references && !dimension.used`.
   * 输入 / Inputs: dimensions: Map<string, number>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.dimensions.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private releaseReferences(dimensions: Map<string, number>) {
    for (const key of dimensions.keys()) {
      const dimension = this.dimensions.get(key)!;
      --dimension.references;
      if (dimension.partition && !dimension.references && !dimension.used) this.dimensions.delete(key);
    }
  }
  /**
   * 入口 / Entry: HostRuntime.finish.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `view.timings`, `aggregate.totalMs`, `aggregate.maxMs`（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; the outcome is recorded in `view.timings`, `aggregate.totalMs`, `aggregate.maxMs`. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `this.elapsed`, `this.clocks.get`, `runtimeTimings.observe`, `this.resources.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.elapsed`, `this.clocks.get`, `runtimeTimings.observe`, `this.resources.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `clock.admitted !== undefined`; `clock.cleanup !== undefined`; `phase === 'execution' && clock.admitted === undefined || phase === 'cleanup' && clock.cleanup === un…`.
   * 输入 / Inputs: view: ResourceView; state: 'released' | 'rejected'
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `runtimeTimings.observe`; `this.resources.delete`; `this.recent.push`; `this.recent.shift`; 更新 / updates `view.timings`, `aggregate.totalMs`, `aggregate.maxMs`, `view.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private finish(view: ResourceView, state: 'released' | 'rejected') {
    view.timings = this.elapsed(view);
    const clock = this.clocks.get(view)!;
    runtimeTimings.observe('resource', 'queue', view.timings.queueMs);
    if (clock.admitted !== undefined) runtimeTimings.observe('resource', 'resource-lifetime', view.timings.lifetimeMs!);
    if (clock.cleanup !== undefined) runtimeTimings.observe('resource', 'cleanup', view.timings.cleanupMs);
    for (const phase of ['queue', 'execution', 'cleanup'] as const) {
      if (phase === 'execution' && clock.admitted === undefined || phase === 'cleanup' && clock.cleanup === undefined) continue;
      const value = view.timings[`${phase}Ms`], aggregate = this.timings[phase];
      aggregate.count++;
      aggregate.totalMs += value;
      aggregate.maxMs = Math.max(aggregate.maxMs, value);
    }
    view.state = state;
    view.finishedAt = new Date().toISOString();
    this.resources.delete(view.id);
    this.recent.push(view);
    if (this.recent.length > 200) this.recent.shift();
  }
  /**
   * 入口 / Entry: HostRuntime.reject.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; this entry produces `void` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `this.unqueue`, `this.releaseReferences`, `failure`, `this.finish` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.unqueue`, `this.releaseReferences`, `failure`, `this.finish`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `request.view.state !== 'queued'`.
   * 输入 / Inputs: request: Request; error: unknown
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.releaseReferences`; `request.reject`; 更新 / updates `request.view.error`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private reject(request: Request, error: unknown) {
    if (request.view.state !== 'queued') return;
    this.unqueue(request);
    this.releaseReferences(request.dimensions);
    request.view.error = failure(error);
    this.finish(request.view, 'rejected');
    ++this.totals.rejected;
    request.reject(error);
  }
  /**
   * 入口 / Entry: HostRuntime.admit.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; this entry produces `void` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `this.unqueue`, `this.reject`, `this.dimensions.get`, `this.clocks.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.unqueue`, `this.reject`, `this.dimensions.get`, `this.clocks.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `request.signal?.aborted`.
   * 输入 / Inputs: request: Request
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `request.resolve`; 更新 / updates `this.dimensions.get(key)!.used`, `request.view.state`, `request.view.admittedAt`, `this.clocks.get(request.view)!.admitted`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private admit(request: Request) {
    this.unqueue(request);
    if (request.signal?.aborted) {
      this.reject(request, request.signal.reason);
      return;
    }
    for (const [key, amount] of request.dimensions) this.dimensions.get(key)!.used += amount;
    request.view.state = 'active';
    request.view.admittedAt = new Date().toISOString();
    this.clocks.get(request.view)!.admitted = performance.now();
    this.lastOwner = request.view.owner;
    ++this.totals.admitted;
    request.resolve(this.lease(request.view, request.dimensions));
  }
  /**
   * 入口 / Entry: HostRuntime.lease.
   * 功能：从当前输入或状态计算 `{ id: view.id, resize: (cost) => { if (released) throw new AppError('已释放资源不能调整预算', 409, 'RESOURCE_RELEASED'); if (view.state …`，供调用方后续验证或使用。
   * Purpose: Computes `{ id: view.id, resize: (cost) => { if (released) throw new AppError('已释放资源不能调整预算', 409, 'RESOURCE_RELEASED'); if (view.state …` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: view: ResourceView; dimensions: Map<string, number>
   * 输出 / Returns: ResourceLease；结果来自 / values from `{ id: view.id, resize: (cost) => { if (released) throw new AppError('已释放资源不能调整预算', 409, 'RESOURCE_RELEASED'); if (view.state …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private lease(view: ResourceView, dimensions: Map<string, number>): ResourceLease {
    let released = false;
    return {
      id: view.id,
      /**
       * 入口 / Entry: HostRuntime.lease.resize.
       * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.dimensions.get(key)!.used`, `view.cost[key]`（`HostRuntime`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; the outcome is recorded in `this.dimensions.get(key)!.used`, `view.cost[key]`. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
       * 处理：通过 `dimensions.has`, `this.dimensions.get`, `dimensions.get`, `dimensions.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dimensions.has`, `this.dimensions.get`, `dimensions.get`, `dimensions.set`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `decreased`.
       * 输入 / Inputs: cost
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `dimensions.set`; 更新 / updates `this.dimensions.get(key)!.used`, `view.cost[key]`, `decreased`.
       * 拒绝 / Refusals: 条件 / conditions `released`; `view.state !== 'active'`; `!dimensions.has(key) || !Number.isSafeInteger(amount) || amount < 0`; 异常 / errors `new AppError('已释放资源不能调整预算', 409, 'RESOURCE_RELEASED')`; `new AppError('待清理资源不能调整预算', 409, 'RESOURCE_CLEANUP_PENDING')`.
       */
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
      /**
       * 入口 / Entry: HostRuntime.lease.release.
       * 功能：在统一管理宿主资源预算、等待队列与租约中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`HostRuntime`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostRuntime`; this entry produces `void` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
       * 处理：通过 `this.dimensions.get`, `this.releaseReferences`, `this.finish`, `this.pump` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.dimensions.get`, `this.releaseReferences`, `this.finish`, `this.pump`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `released`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `this.releaseReferences`; 更新 / updates `released`, `this.dimensions.get(key)!.used`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      release: () => {
        if (released) return;
        released = true;
        for (const [key, amount] of dimensions) this.dimensions.get(key)!.used -= amount;
        this.releaseReferences(dimensions);
        this.finish(view, 'released');
        ++this.totals.released;
        this.pump();
      },
      /**
       * 入口 / Entry: HostRuntime.lease.beginCleanup.
       * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.clocks.get(view)!.cleanup`（`HostRuntime`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; the outcome is recorded in `this.clocks.get(view)!.cleanup`. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
       * 处理：通过 `this.clocks.get`, `performance.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.clocks.get`, `performance.now`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!released`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 更新 / updates `this.clocks.get(view)!.cleanup`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      beginCleanup: () => {
        if (!released) this.clocks.get(view)!.cleanup ??= performance.now();
      },
      /**
       * 入口 / Entry: HostRuntime.lease.cleanupPending.
       * 功能：在统一管理宿主资源预算、等待队列与租约中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`HostRuntime`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostRuntime`; this entry produces `void` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
       * 处理：通过 `this.clocks.get`, `performance.now`, `failure`, `listener` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.clocks.get`, `performance.now`, `failure`, `listener`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `released`.
       * 输入 / Inputs: error
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `listener`; 更新 / updates `view.state`, `clock.cleanup`, `view.error`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      cleanupPending: (error) => {
        if (released) return;
        view.state = 'cleanup-pending';
        const clock = this.clocks.get(view)!;
        clock.cleanup ??= performance.now();
        view.error = failure(error);
        for (const listener of this.cleanupListeners) listener();
      },
      /**
       * 入口 / Entry: HostRuntime.lease.transfer.
       * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `view.previousOwner`, `view.owner`, `view.identity`（`HostRuntime`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; the outcome is recorded in `view.previousOwner`, `view.owner`, `view.identity`. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
       * 处理：通过 `identifier` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `identifier`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: owner
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 更新 / updates `view.previousOwner`, `view.owner`, `view.identity`.
       * 拒绝 / Refusals: 条件 / conditions `released`; 异常 / errors `new AppError('已释放资源不能移交', 409, 'RESOURCE_RELEASED')`.
       */
      transfer: (owner) => {
        if (released) throw new AppError('已释放资源不能移交', 409, 'RESOURCE_RELEASED');
        identifier(owner, '所有者');
        view.previousOwner = view.owner;
        view.owner = owner;
        view.identity = { ...view.identity, owner };
      },
    };
  }
  /**
   * 入口 / Entry: HostRuntime.pump.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; this entry produces `void` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `performance.now`, `this.waiting.filter`, `eligible.map`, `eligible.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `performance.now`, `this.waiting.filter`, `eligible.map`, `eligible.filter`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.pumping`; `!eligible.length`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.pumping`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.pumping = false;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.pumping = false;`; these steps also apply to exceptional exits.
   */
  private pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const now = performance.now();
        const eligible = this.waiting.filter((request) => this.fits(request));
        if (!eligible.length) break;
        /**
         * 入口 / Entry: HostRuntime.pump.priority.
         * 功能：从当前输入或状态计算 `request.view.lane === 'control' ? 2 : request.view.lane === 'interactive' || now - request.queuedAt >= 2000 ? 1 : 0`，供调用方后续验证或使用。
         * Purpose: Computes `request.view.lane === 'control' ? 2 : request.view.lane === 'interactive' || now - request.queuedAt >= 2000 ? 1 : 0` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: request: Request
         * 输出 / Returns: `request.view.lane === 'control' ? 2 : request.view.lane === 'interactive' || now - request.queuedAt >= 2000 ? 1 : 0`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
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

  /**
   * 入口 / Entry: HostRuntime.beginDrain.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostRuntime`; this entry produces `void` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `this.reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.reject`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.state !== 'accepting'`; `request.view.lane !== 'control'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  beginDrain() {
    if (this.state !== 'accepting') return;
    this.state = 'draining';
    for (const request of [...this.waiting])
      if (request.view.lane !== 'control')
        this.reject(request, new AppError('系统正在关闭', 503, 'RESOURCE_DRAINING'));
  }
  /** Called after domain owners finish their cleanup. A failure must remain inspectable. */
  /**
   * 入口 / Entry: HostRuntime.close.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.state`（`HostRuntime`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostRuntime`; the outcome is recorded in `this.state`. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `this.beginDrain`, `this.reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.beginDrain`, `this.reject`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `this.resources.size`; 异常 / errors `new AppError(`仍有 ${this.resources.size} 项资源未确认释放`, 503, 'RESOURCE_CLEANUP_PENDING')`.
   */
  close() {
    this.beginDrain();
    for (const request of [...this.waiting])
      this.reject(request, new AppError('系统已关闭', 503, 'RESOURCE_DRAINING'));
    if (this.resources.size)
      throw new AppError(`仍有 ${this.resources.size} 项资源未确认释放`, 503, 'RESOURCE_CLEANUP_PENDING');
    this.state = 'closed';
  }
  /**
   * 入口 / Entry: HostRuntime.snapshot.
   * 功能：在统一管理宿主资源预算、等待队列与租约中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ state: this.state, budgets: [...this.dimensions].map(([key, value]) => ({ key, capacity: value.capacity, reserved: value.re…` 供上层消费（`HostRuntime`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `HostRuntime`; this entry produces `{ state: this.state, budgets: [...this.dimensions].map(([key, value]) => ({ key, capacity: value.capacity, reserved: value.re…` for its caller. Module context: Owns host budgets, queues and leases; resources with unconfirmed cleanup continue consuming capacity.
   * 处理：通过 `inline.map`, `this.resources.values`, `this.recent.map`, `structuredClone` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.map`, `this.resources.values`, `this.recent.map`, `structuredClone`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: HostRuntimeView；结果来自 / values from `{ state: this.state, budgets: [...this.dimensions].map(([key, value]) => ({ key, capacity: value.capacity, reserved: value.re…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  snapshot(): HostRuntimeView {
    return {
      state: this.state,
      budgets: [...this.dimensions].map(([key, value]) => ({
        key,
        capacity: value.capacity,
        reserved: value.reserved,
        used: value.used,
      })),
      resources: [...this.resources.values()].map((view) => ({ ...structuredClone(view), timings: this.elapsed(view) })),
      recent: this.recent.map((view) => structuredClone(view)),
      queued: this.waiting.length,
      totals: { ...this.totals },
      timings: structuredClone(this.timings),
    };
  }
}
