/**
 * 模块职责：治理网络连接、服务器与原生网络租约，关联身份及资源预算并追踪物理关闭。
 * Module purpose: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
 */
import { randomUUID } from 'node:crypto';
import { createConnection, createServer, type Socket, type Server, type NetConnectOpts } from 'node:net';
import { HostNetworkPool, type Destination } from './host-pool.ts';
import { VmNetworkBackend, type VmNetworkOptions, type VmNetworkLease } from './vm-backend.ts';

export type NetworkIdentity = Readonly<{
  owner: string;
  purpose: string;
  vmId?: string;
  generation?: string;
  projectId?: string;
  scopeId?: string;
}>;
export type NetworkOperation = 'dial' | 'listen' | 'lookup' | 'vm' | 'accept' | 'native';
type Lease = NetworkIdentity & {
  id: string;
  kind: NetworkOperation;
  lane: 'data' | 'management';
  startedAt: string;
  /**
   * 签名 / Signature: Lease.close.
   * 功能：为治理网络连接、服务器与原生网络租约声明 close 的输入与结果契约，所属容器为 Lease。
   * Purpose: Declares the input/result contract for close in Lease. Module responsibility: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close(): void;
};
export type NetworkOptions = {
  maxWorkers: number;
  maxVmWorkers: number;
  connectionsPerWorker: number;
  scaleAt: number;
  idleMs: number;
  maxOwnerConnections: number;
  maxListeners: number;
  maxInboundConnections: number;
  /**
   * 签名 / Signature: NetworkOptions.authorize.
   * 功能：为治理网络连接、服务器与原生网络租约声明 authorize 的输入与结果契约，所属容器为 NetworkOptions。
   * Purpose: Declares the input/result contract for authorize in NetworkOptions. Module responsibility: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 输入 / Inputs: identity: NetworkIdentity; operation: NetworkOperation; destination: Destination optional
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  authorize?: (identity: NetworkIdentity, operation: NetworkOperation, destination?: Destination) => void;
};
/**
 * 入口 / Entry: setting.
 * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` 供上层消费（`network/core.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/core.ts`; this entry produces `value` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
 * 输入 / Inputs: name: string; fallback: number; max: number
 * 输出 / Returns: `value`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!Number.isInteger(value) || value < 1 || value > max`; 异常 / errors `new Error(`Invalid ${name}`)`.
 */
function setting(name: string, fallback: number, max: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
/**
 * 入口 / Entry: networkDefaults.
 * 功能：从当前输入或状态计算 `({ maxWorkers: setting('SAKURA_NETWORK_WORKERS', 4, 16), maxVmWorkers: setting('SAKURA_NETWORK_VM_WORKERS', 2, 8), connection…`，供调用方后续验证或使用。
 * Purpose: Computes `({ maxWorkers: setting('SAKURA_NETWORK_WORKERS', 4, 16), maxVmWorkers: setting('SAKURA_NETWORK_VM_WORKERS', 2, 8), connection…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: NetworkOptions；结果来自 / values from `({ maxWorkers: setting('SAKURA_NETWORK_WORKERS', 4, 16), maxVmWorkers: setting('SAKURA_NETWORK_VM_WORKERS', 2, 8), connection…`.
 * 副作用 / Effects: `setting`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const networkDefaults = (): NetworkOptions => ({
  maxWorkers: setting('SAKURA_NETWORK_WORKERS', 4, 16),
  maxVmWorkers: setting('SAKURA_NETWORK_VM_WORKERS', 2, 8),
  connectionsPerWorker: setting('SAKURA_NETWORK_CONNECTIONS', 128, 1024),
  scaleAt: setting('SAKURA_NETWORK_SCALE_AT', 32, 1024),
  idleMs: setting('SAKURA_NETWORK_IDLE_MS', 30_000, 600_000),
  maxOwnerConnections: 256,
  maxListeners: 128,
  maxInboundConnections: 1024,
});
/**
 * 入口 / Entry: unavailable.
 * 功能：从当前输入或状态计算 `Object.assign(new Error(message), { code })`，供调用方后续验证或使用。
 * Purpose: Computes `Object.assign(new Error(message), { code })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: message: string; code: default='NETWORK_UNAVAILABLE'
 * 输出 / Returns: `Object.assign(new Error(message), { code })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const unavailable = (message: string, code = 'NETWORK_UNAVAILABLE') =>
  Object.assign(new Error(message), { code });

/** Required infrastructure. It intentionally knows nothing about Machines or optional plugins. */
export class NetworkRuntime {
  readonly host: HostNetworkPool;
  readonly vm: VmNetworkBackend;
  private leases = new Map<string, Lease>();
  private releaseWaiters = new Map<string, Set<
  /**
   * 中文功能：登记 NetworkRuntime.releaseWaiters 的资源退役能力，按返回类型允许同步完成或异步等待。
   * English: Registers resource-retirement capability for NetworkRuntime.releaseWaiters, allowing synchronous completion or asynchronous waiting according to its result type.
   * 所属 / Owner: NetworkRuntime.releaseWaiters.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void>>();
  private disposers = new Set<
  /**
   * 中文功能：登记 NetworkRuntime.disposers 的资源退役能力，按返回类型允许同步完成或异步等待。
   * English: Registers resource-retirement capability for NetworkRuntime.disposers, allowing synchronous completion or asynchronous waiting according to its result type.
   * 所属 / Owner: NetworkRuntime.disposers.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void | Promise<void>`.
   */
  () => void | Promise<void>>();
  private servers = new WeakMap<Server,
  /**
   * 中文功能：保存每个受管服务器的关闭能力，done 在实际关闭后通知调用方。
   * English: Stores each managed server's close capability, with done notifying the caller after physical closure.
   * 所属 / Owner: NetworkRuntime.servers.
   * 输入 / Inputs: done?: () => void.
   * 结果 / Result: `void`.
   */
  (done?:
  /**
   * 中文功能：通知受管服务器已实际关闭的可选完成回调。
   * English: Optional completion callback notifying that the managed server has physically closed.
   * 所属 / Owner: NetworkRuntime.servers.done.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void) => void>();
  private vmControl = new Map<number, { identity: NetworkIdentity; signal: AbortSignal }>();
  private pendingVmControl = new Set<number>();
  private draining = false;
  private closed = false;
  private closeTask?: Promise<void>;
  /**
   * 入口 / Entry: NetworkRuntime.constructor.
   * 功能：建立 NetworkRuntime 的治理网络连接、服务器与原生网络租约上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the NetworkRuntime context for this module's responsibility: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: options: NetworkOptions default=networkDefaults()
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.host`, `this.vm`.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(options[name]) || options[name] < 1`; `options.scaleAt > options.connectionsPerWorker`; 异常 / errors `new Error(`Invalid network limit: ${name}`)`; `new Error('Network scale threshold exceeds connection capacity')`.
   */
  constructor(readonly options: NetworkOptions = networkDefaults()) {
    for (const name of [
      'maxWorkers',
      'maxVmWorkers',
      'connectionsPerWorker',
      'scaleAt',
      'idleMs',
      'maxOwnerConnections',
      'maxListeners',
      'maxInboundConnections',
    ] as const)
      if (!Number.isSafeInteger(options[name]) || options[name] < 1)
        throw new Error(`Invalid network limit: ${name}`);
    if (options.scaleAt > options.connectionsPerWorker)
      throw new Error('Network scale threshold exceeds connection capacity');
    this.host = new HostNetworkPool({ ...options, owner: 'core:network-host' });
    this.vm = new VmNetworkBackend(
      new HostNetworkPool({
        maxWorkers: options.maxVmWorkers,
        connectionsPerWorker: 4,
        scaleAt: 1,
        idleMs: options.idleMs,
        owner: 'core:network-vm',
        reserveBackend: true,
      }),
    );
  }
  /**
   * 入口 / Entry: NetworkRuntime.start.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; the calls and state transitions below complete the operation. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `this.check`, `this.host.start` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.check`, `this.host.start`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.host.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async start() {
    this.check({ owner: 'core', purpose: 'startup' }, 'dial');
    await this.host.start();
  }
  /**
   * 入口 / Entry: NetworkRuntime.check.
   * 功能：在治理网络连接、服务器与原生网络租约中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`NetworkRuntime`）。
   * Purpose: Checks admission, input or resource ownership in `NetworkRuntime`; the calls and state transitions below complete the operation. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `unavailable`, `this.options.authorize` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `unavailable`, `this.options.authorize`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: NetworkIdentity; operation: NetworkOperation; destination: Destination optional; management: default=false
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || (this.draining && !management)`; `!identity.owner || !identity.purpose`; `destination && (!destination.host || destination.host.length > 253 || !Number.isInteger(destination.port) || destination.port…`; 异常 / errors `unavailable('Network is shutting down')`; `unavailable('Network owner and purpose are required')`.
   */
  check(
    identity: NetworkIdentity,
    operation: NetworkOperation,
    destination?: Destination,
    management = false,
  ) {
    if (this.closed || (this.draining && !management)) throw unavailable('Network is shutting down');
    if (!identity.owner || !identity.purpose) throw unavailable('Network owner and purpose are required');
    if (
      destination &&
      (!destination.host ||
        destination.host.length > 253 ||
        !Number.isInteger(destination.port) ||
        destination.port < 1 ||
        destination.port > 65535)
    )
      throw unavailable('Invalid network destination');
    this.options.authorize?.(identity, operation, destination);
  }
  /**
   * 入口 / Entry: NetworkRuntime.admit.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `() => { this.leases.delete(id); for (const done of this.releaseWaiters.get(id) || []) done(); this.releaseWaiters.delete(id);…` 供上层消费（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; this entry produces `() => { this.leases.delete(id); for (const done of this.releaseWaiters.get(id) || []) done(); this.releaseWaiters.delete(id);…` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `this.check`, `inline.filter`, `this.leases.values`, `unavailable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.check`, `inline.filter`, `this.leases.values`, `unavailable`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: NetworkIdentity; kind: NetworkOperation; close: () => void; management: default=false
   * 输出 / Returns: `() => { this.leases.delete(id); for (const done of this.releaseWaiters.get(id) || []) done(); this.releaseWaiters.delete(id);…`.
   * 副作用 / Effects: `this.leases.set`.
   * 拒绝 / Refusals: 条件 / conditions `owned.length >= limit || (kind === 'listen' && [...this.leases.values()].filter((lease) => lease.kind === kind).length >= thi…`; 异常 / errors `unavailable('Network owner resource limit reached', 'NETWORK_BUSY')`.
   */
  private admit(identity: NetworkIdentity, kind: NetworkOperation, close: () => void, management = false) {
    this.check(identity, kind, undefined, management);
    const lane = management ? 'management' : 'data';
    const owned = [...this.leases.values()].filter(
      (lease) => lease.owner === identity.owner && lease.kind === kind && lease.lane === lane,
    );
    const limit =
      kind === 'listen' ? this.options.maxListeners : management ? 128 : this.options.maxOwnerConnections;
    if (
      owned.length >= limit ||
      (kind === 'listen' &&
        [...this.leases.values()].filter((lease) => lease.kind === kind).length >=
          this.options.maxListeners) ||
      (kind === 'accept' &&
        [...this.leases.values()].filter((lease) => lease.kind === kind).length >=
          this.options.maxInboundConnections)
    )
      throw unavailable('Network owner resource limit reached', 'NETWORK_BUSY');
    const id = randomUUID();
    this.leases.set(id, { ...identity, id, kind, lane, startedAt: new Date().toISOString(), close });
    return () => {
      this.leases.delete(id);
      for (const done of this.releaseWaiters.get(id) || []) done();
      this.releaseWaiters.delete(id);
    };
  }
  /** Capture existing handles only; a later scope with the same owner is independent. */
  /**
   * 入口 / Entry: NetworkRuntime.whenReleased.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.all([...this.leases.values()] .filter((lease) => identity.scopeId ? lease.scopeId === identity.scopeId : lease.owner …` 供上层消费（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; this entry produces `Promise.all([...this.leases.values()] .filter((lease) => identity.scopeId ? lease.scopeId === identity.scopeId : lease.owner …` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `Promise.all().then`, `Promise.all`, `inline.filter().map`, `inline.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.all().then`, `Promise.all`, `inline.filter().map`, `inline.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: NetworkIdentity
   * 输出 / Returns: `Promise.all([...this.leases.values()] .filter((lease) => identity.scopeId ? lease.scopeId === identity.scopeId : lease.owner …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  whenReleased(identity: NetworkIdentity) {
    return Promise.all([...this.leases.values()]
      .filter((lease) => identity.scopeId ? lease.scopeId === identity.scopeId :
        lease.owner === identity.owner && lease.purpose === identity.purpose)
      .map((lease) => new Promise<void>((done) => {
        const waiters = this.releaseWaiters.get(lease.id) || new Set<
        /**
         * 中文功能：为 NetworkRuntime.whenReleased.then.waiters 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
         * English: Registers event/state-change/phase-completion notification for NetworkRuntime.whenReleased.then.waiters using its declared event data.
         * 所属 / Owner: NetworkRuntime.whenReleased.then.waiters.
         * 输入 / Inputs: 无显式参数 / no explicit parameters.
         * 结果 / Result: `void`.
         */
        () => void>();
        waiters.add(done); this.releaseWaiters.set(lease.id, waiters);
      }))).then(() => {});
  }
  /**
   * 入口 / Entry: NetworkRuntime.dial.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.managementSocket(identity, destination, signal, timeoutMs)` / `socket` 供上层消费（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; this entry produces `this.managementSocket(identity, destination, signal, timeoutMs)` / `socket` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `this.check`, `signal.throwIfAborted`, `unavailable`, `this.managementSocket` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.check`, `signal.throwIfAborted`, `unavailable`, `this.managementSocket`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `management`.
   * 输入 / Inputs: identity: NetworkIdentity; destination: Destination; signal: AbortSignal optional; timeoutMs: number optional; management: default=false
   * 输出 / Returns: `this.managementSocket(identity, destination, signal, timeoutMs)`; `socket`.
   * 副作用 / Effects: `AbortSignal.any`; `release`.
   * 拒绝 / Refusals: 条件 / conditions `timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)`; 异常 / errors `unavailable('Invalid network connection timeout')`; `error`.
   * 失败处理：catch 分支执行 `release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async dial(
    identity: NetworkIdentity,
    destination: Destination,
    signal?: AbortSignal,
    timeoutMs?: number,
    management = false,
  ) {
    this.check(identity, 'dial', destination, management);
    signal?.throwIfAborted();
    if (
      timeoutMs !== undefined &&
      (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    )
      throw unavailable('Invalid network connection timeout');
    // connectLocal owns the management lease itself. Do not count this lane twice.
    if (management) return this.managementSocket(identity, destination, signal, timeoutMs);
    const abort = new AbortController();
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const release = this.admit(identity, 'dial', () => abort.abort(), management);
    try {
      const socket = await this.host.dial(destination, combined, timeoutMs);
      socket.once('close', release);
      return socket;
    } catch (error) {
      release();
      throw error;
    }
  }
  /**
   * 入口 / Entry: NetworkRuntime.managementSocket.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `socket` 供上层消费（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; this entry produces `socket` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `signal.throwIfAborted`, `this.connectLocal`, `signal.addEventListener`, `socket.once` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.connectLocal`, `signal.addEventListener`, `socket.once`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: NetworkIdentity; destination: Destination; signal: AbortSignal optional; timeoutMs: default=10_000
   * 输出 / Returns: `socket`.
   * 副作用 / Effects: `this.connectLocal`; `signal.addEventListener`; `socket.destroy`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `socket.destroy();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `socket.destroy();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async managementSocket(
    identity: NetworkIdentity,
    destination: Destination,
    signal?: AbortSignal,
    timeoutMs = 10_000,
  ) {
    signal?.throwIfAborted();
    const socket = this.connectLocal(identity, destination);
    /**
     * 入口 / Entry: NetworkRuntime.managementSocket.abort.
     * 功能：把本层请求转交 `socket.destroy`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `socket.destroy` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `socket.destroy()`.
     * 副作用 / Effects: `socket.destroy`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abort = () => socket.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    socket.once('close', () => signal?.removeEventListener('abort', abort));
    try {
      /**
       * 入口 / Entry: NetworkRuntime.managementSocket.callback@194.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `setTimeout`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      await new Promise<void>((resolve, reject) => {
        /**
         * 入口 / Entry: NetworkRuntime.managementSocket.done.
         * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NetworkRuntime`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; the calls and state transitions below complete the operation. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
         * 处理：通过 `clearTimeout`, `socket.off`, `reject`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `clearTimeout`, `socket.off`, `reject`, `resolve`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: error: Error optional
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `clearTimeout`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const done = (error?: Error) => {
          clearTimeout(timer);
          socket.off('error', done);
          socket.off('close', closed);
          socket.off('connect', connected);
          error ? reject(error) : resolve();
        };
        /**
         * 入口 / Entry: NetworkRuntime.managementSocket.closed.
         * 功能：在治理网络连接、服务器与原生网络租约中，结束、撤销或清理本次拥有的领域资源；本入口产生 `done(signal?.aborted ? signal.reason : unavailable('Management connection closed'))` 供上层消费（`NetworkRuntime`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `NetworkRuntime`; this entry produces `done(signal?.aborted ? signal.reason : unavailable('Management connection closed'))` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
         * 处理：通过 `done`, `unavailable` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `done`, `unavailable`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `done(signal?.aborted ? signal.reason : unavailable('Management connection closed'))`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const closed = () =>
          done(signal?.aborted ? signal.reason : unavailable('Management connection closed'));
        /**
         * 入口 / Entry: NetworkRuntime.managementSocket.connected.
         * 功能：把本层请求转交 `done`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `done` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `done()`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const connected = () => done();
        const timer = setTimeout(
          () => done(unavailable('Management connection timed out', 'ETIMEDOUT')),
          timeoutMs,
        );
        socket.once('connect', connected);
        socket.once('error', done);
        socket.once('close', closed);
      });
      signal?.throwIfAborted();
      return socket;
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }
  /** Only local management/IPC uses the in-process lane, which stays open while VMs stop. */
  /**
   * 入口 / Entry: NetworkRuntime.connectLocal.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `socket` 供上层消费（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; this entry produces `socket` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `inline.includes`, `unavailable`, `inline.test`, `this.pendingVmControl.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.includes`, `unavailable`, `inline.test`, `this.pendingVmControl.has`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `vm`; `'port' in options`.
   * 输入 / Inputs: identity: NetworkIdentity; options: NetConnectOpts
   * 输出 / Returns: `socket`.
   * 副作用 / Effects: `createConnection`; `vm.signal.addEventListener`; `release`; 更新 / updates `options`, `identity`, `socket`.
   * 拒绝 / Refusals: 条件 / conditions `!options || typeof options !== 'object' || ('host' in options && options.host && !['127.0.0.1', '::1', 'localhost'].includes(…`; `'port' in options`; `'path' in options && options.path`; 异常 / errors `unavailable('Management connections must be local')`; `unavailable('Management TCP connections cannot specify an IPC path')`.
   * 失败处理：catch 分支执行 `release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  connectLocal(identity: NetworkIdentity, options: NetConnectOpts) {
    if (
      !options ||
      typeof options !== 'object' ||
      ('host' in options && options.host && !['127.0.0.1', '::1', 'localhost'].includes(options.host)) ||
      ('lookup' in options && options.lookup)
    )
      throw unavailable('Management connections must be local');
    // Resolve localhost ourselves. A caller-provided resolver or a hosts-file entry
    // must never turn the trusted shutdown lane into an external connection.
    if ('port' in options) {
      if ('path' in options && options.path)
        throw unavailable('Management TCP connections cannot specify an IPC path');
      options = { ...options, host: options.host === '::1' ? '::1' : '127.0.0.1' };
    } else if (
      typeof options.path !== 'string' ||
      !options.path ||
      (process.platform === 'win32' && !/^\\\\[.?]\\pipe\\/i.test(options.path))
    ) {
      throw unavailable('Management IPC connections must use a local pipe');
    }
    if ('port' in options && this.pendingVmControl.has(Number(options.port)))
      throw unavailable('VM management attachment is not ready');
    const vm = 'port' in options ? this.vmControl.get(Number(options.port)) : undefined;
    if (
      vm &&
      ((identity.vmId && identity.vmId !== vm.identity.vmId) ||
        (identity.generation && identity.generation !== vm.identity.generation))
    )
      throw unavailable('VM management generation no longer matches');
    if (vm) identity = { ...identity, ...vm.identity, owner: identity.owner };
    if ('port' in options)
      this.check(identity, 'dial', { host: options.host!, port: Number(options.port) }, true);
    let socket: Socket;
    const release = this.admit(identity, 'dial', () => socket?.destroy(), true);
    try {
      vm?.signal.throwIfAborted();
      socket = createConnection(options);
      /**
       * 入口 / Entry: NetworkRuntime.connectLocal.revoke.
       * 功能：把本层请求转交 `socket.destroy`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `socket.destroy` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `socket.destroy()`.
       * 副作用 / Effects: `socket.destroy`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const revoke = () => socket.destroy();
      vm?.signal.addEventListener('abort', revoke, { once: true });
      socket.once('close', () => {
        release();
        vm?.signal.removeEventListener('abort', revoke);
      });
      return socket;
    } catch (error) {
      release();
      throw error;
    }
  }
  /**
   * 入口 / Entry: NetworkRuntime.manageServer.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `server` 供上层消费（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; this entry produces `server` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `this.servers.has`, `unavailable`, `signal.throwIfAborted`, `this.admit` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.servers.has`, `unavailable`, `signal.throwIfAborted`, `this.admit`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: NetworkIdentity; server: T; signal: AbortSignal optional
   * 输出 / Returns: T；结果来自 / values from `server`.
   * 副作用 / Effects: `this.servers.set`; `server.listen.bind`; `signal.addEventListener`; 更新 / updates `(server as Server).listen`, `server.maxConnections`.
   * 拒绝 / Refusals: 条件 / conditions `this.servers.has(server)`; 异常 / errors `unavailable('Server is already managed')`.
   */
  manageServer<T extends Server>(identity: NetworkIdentity, server: T, signal?: AbortSignal): T {
    if (this.servers.has(server)) throw unavailable('Server is already managed');
    signal?.throwIfAborted();
    const sockets = new Set<Socket>();
    /**
     * 入口 / Entry: NetworkRuntime.manageServer.close.
     * 功能：在治理网络连接、服务器与原生网络租约中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`NetworkRuntime`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `NetworkRuntime`; the calls and state transitions below complete the operation. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
     * 处理：通过 `socket.destroy`, `server.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `socket.destroy`, `server.close`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: done: () => void optional
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `socket.destroy`; `server.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const close = (done?:
    /**
     * 中文功能：在关闭回执处理中通知调用方原服务器实际结束。
     * English: Notifies the caller of the original server's physical completion during close-receipt handling.
     * 所属 / Owner: NetworkRuntime.manageServer.close.done.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => done?.());
    };
    /**
     * 入口 / Entry: NetworkRuntime.manageServer.onAbort.
     * 功能：把本层请求转交 `close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `close` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `close()`.
     * 副作用 / Effects: `close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const onAbort = () => close();
    let release: (
    /**
     * 中文功能：登记 NetworkRuntime.manageServer.release 的资源退役能力，按返回类型允许同步完成或异步等待。
     * English: Registers resource-retirement capability for NetworkRuntime.manageServer.release, allowing synchronous completion or asynchronous waiting according to its result type.
     * 所属 / Owner: NetworkRuntime.manageServer.release.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void) | undefined = this.admit(identity, 'listen', close);
    /**
     * 入口 / Entry: NetworkRuntime.manageServer.releaseListener.
     * 功能：在治理网络连接、服务器与原生网络租约中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`NetworkRuntime`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `NetworkRuntime`; the calls and state transitions below complete the operation. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
     * 处理：通过 `release`, `signal.removeEventListener` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `release`, `signal.removeEventListener`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `release`; 更新 / updates `release`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const releaseListener = () => {
      release?.();
      release = undefined;
      signal?.removeEventListener('abort', onAbort);
    };
    this.servers.set(server, close);
    const listen = server.listen.bind(server);
    /**
     * 入口 / Entry: NetworkRuntime.manageServer.callback@288.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: args: any[]
     * 输出 / Returns: `listen(...(args as Parameters<Server['listen']>))`.
     * 副作用 / Effects: `signal.addEventListener`; `listen`; `releaseListener`; 更新 / updates `release`.
     * 拒绝 / Refusals: 异常 / errors `error`.
     * 失败处理：catch 分支执行 `if (!server.listening) releaseListener();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (!server.listening) releaseListener();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    (server as Server).listen = ((...args: any[]) => {
      signal?.throwIfAborted();
      this.check(identity, 'listen');
      release ||= this.admit(identity, 'listen', close);
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        return listen(...(args as Parameters<Server['listen']>));
      } catch (error) {
        if (!server.listening) releaseListener();
        throw error;
      }
    }) as Server['listen'];
    server.maxConnections = Math.min(server.maxConnections ?? 256, 256);
    /**
     * 入口 / Entry: NetworkRuntime.manageServer.callback@301.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（server.prependListener / connection）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (server.prependListener / connection).
     * 输入 / Inputs: socket: Socket
     * 输出 / Returns: `socket.destroy()`; `void`.
     * 副作用 / Effects: `socket.destroy`; `sockets.add`; 更新 / updates `accepted`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `socket.destroy();`; `return;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `socket.destroy();`; `return;`; these statements determine whether a failure is absorbed or rejected again.
     */
    server.prependListener('connection', (socket: Socket) => {
      if (this.closed || signal?.aborted) return socket.destroy();
      let accepted:
      /**
       * 中文功能：记录服务器接受连接后的资源结算通知。
       * English: Resource-settlement notification associated with a server-accepted connection.
       * 所属 / Owner: NetworkRuntime.manageServer.accepted.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       * 结果 / Result: `void`.
       */
      () => void;
      try {
        accepted = this.admit(identity, 'accept', () => socket.destroy());
      } catch {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.once('close', () => {
        accepted();
        sockets.delete(socket);
      });
    });
    server.on('close', releaseListener);
    // A failed bind never produces 'close' unless explicitly closed by the owner.
    server.on('error', () => {
      if (!server.listening) releaseListener();
    });
    // Keep the abort subscription across close/listen cycles.
    signal?.addEventListener('abort', onAbort, { once: true });
    return server;
  }
  /**
   * 入口 / Entry: NetworkRuntime.closeServer.
   * 功能：从当前输入或状态计算 `new Promise<void>((resolve) => { if (close) close(resolve); else server.close(() => resolve()); })`，供调用方后续验证或使用。
   * Purpose: Computes `new Promise<void>((resolve) => { if (close) close(resolve); else server.close(() => resolve()); })` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: server: Server
   * 输出 / Returns: `new Promise<void>((resolve) => { if (close) close(resolve); else server.close(() => resolve()); })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  closeServer(server: Server) {
    const close = this.servers.get(server);
    return new Promise<void>((resolve) => {
      if (close) close(resolve);
      else server.close(() => resolve());
    });
  }
  /** Native local adapters retain OS peer attestation; the core owns their admission and cancellation. */
  /**
   * 入口 / Entry: NetworkRuntime.nativeLease.
   * 功能：把本层请求转交 `this.admit`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.admit` and propagates the provider result or rejection.
   * 输入 / Inputs: identity: NetworkIdentity; cancel: () => void
   * 输出 / Returns: `this.admit(identity, 'native', cancel, true)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  nativeLease(identity: NetworkIdentity, cancel: () => void) {
    return this.admit(identity, 'native', cancel, true);
  }
  /**
   * 入口 / Entry: NetworkRuntime.lookup.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await this.host.lookup(hostname, options, combined)` 供上层消费（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; this entry produces `await this.host.lookup(hostname, options, combined)` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `this.check`, `signal.throwIfAborted`, `unavailable`, `AbortSignal.any` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.check`, `signal.throwIfAborted`, `unavailable`, `AbortSignal.any`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: NetworkIdentity; hostname: string; options: Record<string, unknown>; signal: AbortSignal optional
   * 输出 / Returns: `await this.host.lookup(hostname, options, combined)`.
   * 副作用 / Effects: `AbortSignal.any`; `release`.
   * 拒绝 / Refusals: 条件 / conditions `typeof hostname !== 'string' || !hostname || hostname.length > 253`; 异常 / errors `unavailable('Invalid DNS hostname')`.
   * 收尾：退出 try 区域时始终执行 `release();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `release();`; these steps also apply to exceptional exits.
   */
  async lookup(
    identity: NetworkIdentity,
    hostname: string,
    options: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    this.check(identity, 'lookup');
    signal?.throwIfAborted();
    if (typeof hostname !== 'string' || !hostname || hostname.length > 253)
      throw unavailable('Invalid DNS hostname');
    const abort = new AbortController();
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const release = this.admit(identity, 'lookup', () => abort.abort());
    try {
      return await this.host.lookup(hostname, options, combined);
    } finally {
      release();
    }
  }
  /**
   * 入口 / Entry: NetworkRuntime.attachVm.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `track(await this.vm.attach(options))` 供上层消费（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; this entry produces `track(await this.vm.attach(options))` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `this.check`, `ports.map`, `numbers.some`, `unavailable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.check`, `ports.map`, `numbers.some`, `unavailable`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: options: VmNetworkOptions
   * 输出 / Returns: `track(await this.vm.attach(options))`.
   * 副作用 / Effects: `this.pendingVmControl.add`; `this.pendingVmControl.delete`.
   * 拒绝 / Refusals: 条件 / conditions `numbers.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) || new Set(numbers).size !== numbers.length`; `numbers.some((port) => this.vmControl.has(port) || this.pendingVmControl.has(port))`; 异常 / errors `unavailable('Invalid VM management ports')`; `unavailable('VM management port is already owned')`.
   * 收尾：退出 try 区域时始终执行 `for (const port of numbers) this.pendingVmControl.delete(port);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `for (const port of numbers) this.pendingVmControl.delete(port);`; these steps also apply to exceptional exits.
   */
  async attachVm(options: VmNetworkOptions) {
    this.check(
      {
        owner: 'vm:' + options.vmId,
        purpose: 'user-network',
        vmId: options.vmId,
        generation: options.generation,
      },
      'vm',
    );
    const ports = Object.entries(options.managementPorts || {});
    const numbers = ports.map(([, port]) => port);
    if (
      numbers.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) ||
      new Set(numbers).size !== numbers.length
    )
      throw unavailable('Invalid VM management ports');
    if (numbers.some((port) => this.vmControl.has(port) || this.pendingVmControl.has(port)))
      throw unavailable('VM management port is already owned');
    for (const port of numbers) this.pendingVmControl.add(port);
    /**
     * 入口 / Entry: NetworkRuntime.attachVm.track.
     * 功能：从当前输入或状态计算 `{ vmId: lease.vmId, generation: lease.generation, get netdev() { return lease.netdev; }, signal: lease.signal, get resources(…`，供调用方后续验证或使用。
     * Purpose: Computes `{ vmId: lease.vmId, generation: lease.generation, get netdev() { return lease.netdev; }, signal: lease.signal, get resources(…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: lease: VmNetworkLease
     * 输出 / Returns: VmNetworkLease；结果来自 / values from `{ vmId: lease.vmId, generation: lease.generation, get netdev() { return lease.netdev; }, signal: lease.signal, get resources(…`.
     * 副作用 / Effects: `this.vmControl.set`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const track = (lease: VmNetworkLease): VmNetworkLease => {
      for (const [purpose, port] of ports)
        this.vmControl.set(port, {
          signal: lease.signal,
          identity: {
            owner: 'vm:' + options.vmId,
            purpose,
            vmId: options.vmId,
            generation: lease.generation,
          },
        });
      // Retain revoked entries until teardown or replacement. Removing one during
      // renew would briefly admit an untagged connection to the old VM generation.
      return {
        vmId: lease.vmId,
        generation: lease.generation,
        /**
         * 入口 / Entry: NetworkRuntime.attachVm.netdev.
         * 功能：向调用者提供 `lease.netdev` 的当前视图，不复制独立的业务状态。
         * Purpose: Exposes the current `lease.netdev` view rather than creating separate domain state.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `lease.netdev`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        get netdev() {
          return lease.netdev;
        },
        signal: lease.signal,
        /**
         * 入口 / Entry: NetworkRuntime.attachVm.resources.
         * 功能：向调用者提供 `lease.resources` 的当前视图，不复制独立的业务状态。
         * Purpose: Exposes the current `lease.resources` view rather than creating separate domain state.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `lease.resources`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        get resources() {
          return lease.resources;
        },
        /**
         * 入口 / Entry: NetworkRuntime.attachVm.connected.
         * 功能：向调用者提供 `lease.connected` 的当前视图，不复制独立的业务状态。
         * Purpose: Exposes the current `lease.connected` view rather than creating separate domain state.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `lease.connected`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        get connected() {
          return lease.connected;
        },
        setConnected: lease.setConnected,
        /**
         * 入口 / Entry: NetworkRuntime.attachVm.policy.
         * 功能：向调用者提供 `lease.policy` 的当前视图，不复制独立的业务状态。
         * Purpose: Exposes the current `lease.policy` view rather than creating separate domain state.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `lease.policy`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        get policy() {
          return lease.policy;
        },
        forward: lease.forward,
        /**
         * 入口 / Entry: NetworkRuntime.attachVm.close.
         * 功能：在治理网络连接、服务器与原生网络租约中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`NetworkRuntime`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `NetworkRuntime`; the calls and state transitions below complete the operation. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
         * 处理：通过 `lease.close`, `this.vmControl.get`, `this.vmControl.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `lease.close`, `this.vmControl.get`, `this.vmControl.delete`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `this.vmControl.get(port)?.signal === lease.signal`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `lease.close`; `this.vmControl.delete`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        close: async () => {
          await lease.close();
          for (const [, port] of ports)
            if (this.vmControl.get(port)?.signal === lease.signal) this.vmControl.delete(port);
        },
        /**
         * 入口 / Entry: NetworkRuntime.attachVm.renew.
         * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `track(await lease.renew(generation))` 供上层消费（`NetworkRuntime`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; this entry produces `track(await lease.renew(generation))` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
         * 处理：通过 `track`, `lease.renew` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `track`, `lease.renew`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: generation
         * 输出 / Returns: `track(await lease.renew(generation))`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        renew: async (generation) => track(await lease.renew(generation)),
      };
    };
    try {
      return track(await this.vm.attach(options));
    } finally {
      for (const port of numbers) this.pendingVmControl.delete(port);
    }
  }
  /**
   * 入口 / Entry: NetworkRuntime.own.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `() => this.disposers.delete(dispose)` 供上层消费（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; this entry produces `() => this.disposers.delete(dispose)` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `unavailable`, `this.disposers.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `unavailable`, `this.disposers.add`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: dispose: () => void | Promise<void>
   * 输出 / Returns: `() => this.disposers.delete(dispose)`.
   * 副作用 / Effects: `this.disposers.add`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `unavailable('Network is shut down')`.
   */
  own(dispose: () => void | Promise<void>) {
    if (this.closed) throw unavailable('Network is shut down');
    this.disposers.add(dispose);
    return () => this.disposers.delete(dispose);
  }
  /**
   * 入口 / Entry: NetworkRuntime.beginDrain.
   * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.draining`（`NetworkRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkRuntime`; the outcome is recorded in `this.draining`. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.draining`.
   */
  beginDrain() {
    this.draining = true;
  }
  /**
   * 入口 / Entry: NetworkRuntime.snapshot.
   * 功能：在治理网络连接、服务器与原生网络租约中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ state: this.closed ? 'closed' : this.draining ? 'draining' : 'running', limits, // Node workers and CPU-less backends share…` 供上层消费（`NetworkRuntime`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `NetworkRuntime`; this entry produces `{ state: this.closed ? 'closed' : this.draining ? 'draining' : 'running', limits, // Node workers and CPU-less backends share…` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `this.host.snapshot`, `this.vm.pool.snapshot`, `this.vm.snapshot`, `inline.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.host.snapshot`, `this.vm.pool.snapshot`, `this.vm.snapshot`, `inline.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ state: this.closed ? 'closed' : this.draining ? 'draining' : 'running', limits, // Node workers and CPU-less backends share…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  snapshot() {
    const { authorize: _authorize, ...limits } = this.options;
    return {
      state: this.closed ? 'closed' : this.draining ? 'draining' : 'running',
      limits,
      // Node workers and CPU-less backends share the host's global process/network budgets.
      maxChildProcesses: this.options.maxWorkers + 2 * this.options.maxVmWorkers,
      hostWorkers: this.host.snapshot(),
      vmWorkers: this.vm.pool.snapshot(),
      vms: this.vm.snapshot(),
      managementListeners: [...this.vmControl].map(([port, { identity }]) => ({ port, ...identity })),
      leases: [...this.leases.values()].map(({ close: _close, ...lease }) => lease),
    };
  }
  /**
   * 入口 / Entry: NetworkRuntime.close.
   * 功能：在治理网络连接、服务器与原生网络租约中，结束、撤销或清理本次拥有的领域资源；本入口产生 `(this.closeTask ||= (async () => { this.draining = true; this.closed = true; const errors: unknown[] = []; for (const lease o…` 供上层消费（`NetworkRuntime`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `NetworkRuntime`; this entry produces `(this.closeTask ||= (async () => { this.draining = true; this.closed = true; const errors: unknown[] = []; for (const lease o…` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
   * 处理：通过 `inline().catch`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline().catch`, `inline`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `(this.closeTask ||= (async () => { this.draining = true; this.closed = true; const errors: unknown[] = []; for (const lease o…`.
   * 副作用 / Effects: 更新 / updates `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    /**
     * 入口 / Entry: NetworkRuntime.close.callback@443.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `lease.close`; `errors.push`; `this.vm.close`; `this.host.close`; `this.vmControl.clear`; 更新 / updates `this.draining`, `this.closed`.
     * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `new AggregateError(errors, 'Network cleanup failed')`.
     * 失败处理：catch 分支执行 `errors.push(error);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `errors.push(error);`; these statements determine whether a failure is absorbed or rejected again.
     */
    return (this.closeTask ||= (async () => {
      this.draining = true;
      this.closed = true;
      const errors: unknown[] = [];
      for (const lease of this.leases.values()) {
        try {
          lease.close();
        } catch (error) {
          errors.push(error);
        }
      }
      const disposed = await Promise.allSettled([...this.disposers].map(async (dispose) => dispose()));
      const closed = await Promise.allSettled([this.vm.close(), this.host.close()]);
      this.vmControl.clear();
      for (const result of [...disposed, ...closed])
        if (result.status === 'rejected') errors.push(result.reason);
      if (errors.length) throw new AggregateError(errors, 'Network cleanup failed');
    })().catch((error) => {
      this.closeTask = undefined;
      throw error;
    }));
  }
}

export const networkRuntime = new NetworkRuntime();

// A reservation probe is also registered with the core, without consuming a data worker.
/**
 * 入口 / Entry: reserveAvailablePort.
 * 功能：在治理网络连接、服务器与原生网络租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new Promise<number>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = (…` 供上层消费（`network/core.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/core.ts`; this entry produces `new Promise<number>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = (…` for its caller. Module context: Governs connections, servers and native network leases, associating identity and budgets with physical closure tracking.
 * 处理：通过 `networkRuntime.manageServer`, `createServer` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `networkRuntime.manageServer`, `createServer`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: identity: NetworkIdentity
 * 输出 / Returns: `new Promise<number>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = (…`.
 * 副作用 / Effects: `createServer`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function reserveAvailablePort(identity: NetworkIdentity) {
  const server = networkRuntime.manageServer(identity, createServer());
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
