/**
 * 模块职责：管理宿主网络工作进程和连接池，固定目标并在清理失败时保留原租约供重试。
 * Module purpose: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
 */
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../paths.ts';
import { hostRuntime, type ResourceLease } from '../host-runtime/index.ts';
import { AppError } from '../../shared/errors.ts';

export type Destination = { host: string; port: number; family?: number };
export type PoolOptions = {
  maxWorkers: number;
  connectionsPerWorker: number;
  scaleAt: number;
  idleMs: number;
  owner?: string;
  reserveBackend?: boolean;
};
type PoolDependencies = {
  governor?: Pick<typeof hostRuntime, 'tryAcquire'>;
  /**
   * 签名 / Signature: PoolDependencies.forkWorker.
   * 功能：为管理宿主网络工作进程和连接池声明 forkWorker 的输入与结果契约，所属容器为 PoolDependencies。
   * Purpose: Declares the input/result contract for forkWorker in PoolDependencies. Module responsibility: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 输入 / Inputs: file: string; limit: number
   * 输出 / Returns: ChildProcess.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  forkWorker?: (file: string, limit: number) => ChildProcess;
  /**
   * 签名 / Signature: PoolDependencies.spawnBackend.
   * 功能：为管理宿主网络工作进程和连接池声明 spawnBackend 的输入与结果契约，所属容器为 PoolDependencies。
   * Purpose: Declares the input/result contract for spawnBackend in PoolDependencies. Module responsibility: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 输入 / Inputs: file: string; args: string[]
   * 输出 / Returns: ChildProcess.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  spawnBackend?: (file: string, args: string[]) => ChildProcess;
  closeTimeoutMs?: number;
};
type Pending = {
/**
 * 签名 / Signature: Pending.resolve.
 * 功能：为管理宿主网络工作进程和连接池声明 resolve 的输入与结果契约，所属容器为 Pending。
 * Purpose: Declares the input/result contract for resolve in Pending. Module responsibility: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
 * 输入 / Inputs: value: any
 * 输出 / Returns: void.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
resolve(value: any): void;
/**
 * 签名 / Signature: Pending.reject.
 * 功能：为管理宿主网络工作进程和连接池声明 reject 的输入与结果契约，所属容器为 Pending。
 * Purpose: Declares the input/result contract for reject in Pending. Module responsibility: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
 * 输入 / Inputs: error: Error
 * 输出 / Returns: void.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
reject(error: Error): void; timer: NodeJS.Timeout };
/**
 * 入口 / Entry: failure.
 * 功能：从当前输入或状态计算 `Object.assign(new Error(message), { code })`，供调用方后续验证或使用。
 * Purpose: Computes `Object.assign(new Error(message), { code })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: message: string; code: default='NETWORK_UNAVAILABLE'
 * 输出 / Returns: `Object.assign(new Error(message), { code })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const failure = (message: string, code = 'NETWORK_UNAVAILABLE') =>
  Object.assign(new Error(message), { code });
/**
 * 入口 / Entry: abortable.
 * 功能：从当前输入或状态计算 `new Promise((resolve, reject) => { const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); }…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise((resolve, reject) => { const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); }…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: promise: Promise<T>; signal: AbortSignal
 * 输出 / Returns: Promise<T>；结果来自 / values from `new Promise((resolve, reject) => { const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); }…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  /**
   * 入口 / Entry: abortable.callback@32.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: resolve; reject
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `signal.addEventListener`; `abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return new Promise((resolve, reject) => {
    /**
     * 入口 / Entry: abortable.abort.
     * 功能：在管理宿主网络工作进程和连接池中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`network/host-pool.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `network/host-pool.ts`; the calls and state transitions below complete the operation. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
     * 处理：通过 `signal.removeEventListener`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.removeEventListener`, `reject`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

/**
 * 入口 / Entry: cleanupFailure.
 * 功能：从当前输入或状态计算 `new AppError('Network process cleanup is not confirmed', 503, 'HOST_PROCESS_CLEANUP_PENDING')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('Network process cleanup is not confirmed', 503, 'HOST_PROCESS_CLEANUP_PENDING')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('Network process cleanup is not confirmed', 503, 'HOST_PROCESS_CLEANUP_PENDING')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const cleanupFailure = () =>
  new AppError('Network process cleanup is not confirmed', 503, 'HOST_PROCESS_CLEANUP_PENDING');
/**
 * 入口 / Entry: parentExecArgs.
 * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `['-I', '-S', helper, String(process.pid), program]` 供上层消费（`network/host-pool.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/host-pool.ts`; this entry produces `['-I', '-S', helper, String(process.pid), program]` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
 * 处理：通过 `join`, `existsSync`, `failure` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `existsSync`, `failure`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: program: string
 * 输出 / Returns: `['-I', '-S', helper, String(process.pid), program]`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!existsSync(helper)`; 异常 / errors `failure('Network parent ownership helper is unavailable')`.
 */
function parentExecArgs(program: string) {
  const source = join(ROOT, 'server/network/parent-exec.py');
  const helper = existsSync(source) ? source : join(ROOT, '.sakura-server/assets/network-parent-exec.py');
  if (!existsSync(helper)) throw failure('Network parent ownership helper is unavailable');
  return ['-I', '-S', helper, String(process.pid), program];
}
/**
 * 入口 / Entry: waitForClose.
 * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.race([ closed.then(() => true), new Promise<boolean>((done) => { timer = setTimeout(() => done(false), timeoutMs); })…` 供上层消费（`network/host-pool.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/host-pool.ts`; this entry produces `Promise.race([ closed.then(() => true), new Promise<boolean>((done) => { timer = setTimeout(() => done(false), timeoutMs); })…` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
 * 处理：通过 `Promise.race().finally`, `Promise.race`, `closed.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `Promise.race().finally`, `Promise.race`, `closed.then`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: closed: Promise<void>; timeoutMs: number
 * 输出 / Returns: Promise<boolean>；结果来自 / values from `Promise.race([ closed.then(() => true), new Promise<boolean>((done) => { timer = setTimeout(() => done(false), timeoutMs); })…`.
 * 副作用 / Effects: `closed.then`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function waitForClose(closed: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    closed.then(() => true),
    new Promise<boolean>((done) => {
      timer = setTimeout(() => done(false), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
type Backend = {
  child: ChildProcess;
  lease: ResourceLease;
  id: string;
  binary: string;
  stopped: Promise<void>;
  ended: boolean;
  closed: boolean;
  writing: number;
  closeTask?: Promise<void>;
};

class HostWorker {
  readonly child: ChildProcess;
  readonly ready: Promise<number>;
  readonly leases = new Set<string>();
  private pending = new Map<string, Pending>();
  private unavailable = false;
  private inFlight = 0;
  /**
   * 签名 / Signature: HostWorker.rejectReady.
   * 功能：为管理宿主网络工作进程和连接池声明 rejectReady 的输入与结果契约，所属容器为 HostWorker。
   * Purpose: Declares the input/result contract for rejectReady in HostWorker. Module responsibility: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 输入 / Inputs: error: Error
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private rejectReady!: (error: Error) => void;
  private stopped: Promise<void>;
  private closeTask?: Promise<void>;
  private childClosed = false;
  private childEnded = false;
  private finalized = false;
  private backend?: Backend;
  cleanupError?: Error;
  idleAt = Date.now();
  /**
   * 入口 / Entry: HostWorker.backendPid.
   * 功能：向调用者提供 `this.backend?.closed ? undefined : this.backend?.child.pid` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.backend?.closed ? undefined : this.backend?.child.pid` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.backend?.closed ? undefined : this.backend?.child.pid`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get backendPid() {
    return this.backend?.closed ? undefined : this.backend?.child.pid;
  }
  /**
   * 入口 / Entry: HostWorker.backendResourceId.
   * 功能：向调用者提供 `this.backend?.lease.id || this.backendReservation?.id` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.backend?.lease.id || this.backendReservation?.id` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.backend?.lease.id || this.backendReservation?.id`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get backendResourceId() {
    return this.backend?.lease.id || this.backendReservation?.id;
  }
  /**
   * 入口 / Entry: HostWorker.available.
   * 功能：向调用者提供 `!this.unavailable` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `!this.unavailable` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `!this.unavailable`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get available() {
    return !this.unavailable;
  }
  /**
   * 入口 / Entry: HostWorker.constructor.
   * 功能：创建网络工作进程与 IPC 状态，登记就绪等待、失败处理和预算归属。
   * Purpose: Creates a network worker/IPC state with readiness waits, failure handling and budget ownership.
   * 设计：工作进程和可选后端分别受监督；协议断开或就绪超时关闭原参与者，物理退出前不释放额度。
   * Design: Worker/backend are supervised separately; disconnect/readiness timeout closes original participants without early budget release.
   * 输入 / Inputs: options: PoolOptions; resource: ResourceLease; dependencies: PoolDependencies; onExit: (worker: HostWorker) => void; onFinalized: (worker: HostWorker) => void; backendReservation: ResourceLease optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `setTimeout`; 更新 / updates `this.child`, `this.ready`, `this.stopped`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    readonly options: PoolOptions,
    readonly resource: ResourceLease,
    private dependencies: PoolDependencies,
    private onExit: (worker: HostWorker) => void,
    private onFinalized: (worker: HostWorker) => void,
    private backendReservation?: ResourceLease,
  ) {
    const source = join(ROOT, 'server/network/worker.mjs');
    const file = existsSync(source) ? source : join(ROOT, '.sakura-server/assets/network-worker.mjs');
    this.child = dependencies.forkWorker
      ? dependencies.forkWorker(file, options.connectionsPerWorker)
      : fork(file, [], {
          ...(process.platform === 'linux'
            ? { execPath: 'python3', execArgv: parentExecArgs(process.execPath) }
            : { execArgv: [] }),
          detached: false,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: { ...process.env, SAKURA_NETWORK_WORKER_LIMIT: String(options.connectionsPerWorker) },
        });
    let resolveReady!:
    /**
     * 中文功能：完成 HostWorker.resolveReady 所属异步等待或资源阶段；结果按本声明参数交付。
     * English: Completes the asynchronous wait/resource phase owned by HostWorker.resolveReady using the declared result parameters.
     * 所属 / Owner: HostWorker.resolveReady.
     * 输入 / Inputs: port: number.
     * 结果 / Result: `void`.
     */
    (port: number) => void;
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.ready.catch(() => {});
    const startupTimer = setTimeout(() => {
      this.fail(failure('Network worker startup timed out'));
      this.retire();
    }, 10_000);
    /**
     * 入口 / Entry: HostWorker.constructor.callback@137.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（this.child.on / message）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (this.child.on / message).
     * 输入 / Inputs: message: any
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `clearTimeout`; `inline.write`; `this.stopBackend().catch`; `this.stopBackend`; `this.pending.delete`; 更新 / updates `backend.writing`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    this.child.on('message', (message: any) => {
      if (!message || typeof message !== 'object') return;
      if (message.event === 'ready') {
        if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
          this.fail(failure('Invalid network worker endpoint'));
          this.retire();
          return;
        }
        clearTimeout(startupTimer);
        resolveReady(message.port);
      } else if (message.event === 'backend-write') {
        const backend = this.backend;
        if (
          !backend ||
          backend.closed ||
          backend.id !== message.backendId ||
          this.unavailable ||
          typeof message.bytes !== 'string' ||
          Buffer.byteLength(message.bytes) > 1024 * 1024
        ) {
          this.fail(failure('Invalid network backend write'));
          this.retire();
          return;
        }
        const bytes = Buffer.byteLength(message.bytes);
        if (backend.writing + bytes > 2 * 1024 * 1024) {
          this.fail(failure('Network backend control buffer is full'));
          this.retire();
          return;
        }
        backend.writing += bytes;
        backend.child.stdin!.write(message.bytes, (error) => {
          backend.writing -= bytes;
          if (error) {
            this.fail(error);
            this.retire();
          }
        });
      } else if (message.event === 'backend-stop') {
        if (message.backendId === this.backend?.id) void this.stopBackend().catch(() => {});
      } else if (message.requestId) {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(failure(message.error.message, message.error.code));
        else pending.resolve(message.value);
      }
    });
    this.child.once('exit', () => {
      this.childEnded = true;
    });
    /**
     * 入口 / Entry: HostWorker.constructor.callback@190.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（this.child.once / close）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (this.child.once / close).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `clearTimeout`; `resource.release`; `this.backendReservation.release`; 更新 / updates `this.childEnded`, `this.childClosed`, `this.backendReservation`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 收尾：退出 try 区域时始终执行 `done();`; `this.finalize();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `done();`; `this.finalize();`; these steps also apply to exceptional exits.
     */
    this.stopped = new Promise((done) =>
      this.child.once('close',
      /**
       * 中文功能：处理 worker 退出，清除启动计时、拒绝待办并释放资源；无后端时归还预留，finally 完成退出及退役。
       * English: Handles worker exit, clears startup timing, fails pending work and releases resources; returns unused backend reservation and finalizes/retire in finally.
       * 所属 / Owner: HostWorker.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       */
      () => {
        this.childEnded = this.childClosed = true;
        clearTimeout(startupTimer);
        this.fail(failure('Network worker exited'));
        resource.release();
        if (!this.backend) {
          this.backendReservation?.release();
          this.backendReservation = undefined;
        }
        try {
          this.onExit(this);
        } finally {
          done();
          this.finalize();
          this.retire();
        }
      }),
    );
    this.child.on('error', (error) => {
      clearTimeout(startupTimer);
      this.fail(error);
      this.retire();
    });
    this.child.once('disconnect', () => {
      this.fail(failure('Network worker disconnected'));
      this.retire();
    });
  }
  /**
   * 入口 / Entry: HostWorker.retire.
   * 功能：在管理宿主网络工作进程和连接池中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`HostWorker`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostWorker`; the calls and state transitions below complete the operation. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `this.close().catch`, `this.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.close().catch`, `this.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.close().catch`; `this.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private retire() {
    void this.close().catch(() => {});
  }
  /**
   * 入口 / Entry: HostWorker.finalize.
   * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostWorker`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostWorker`; this entry produces `void` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `this.onFinalized` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.onFinalized`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.finalized || !this.childClosed || (this.backend && !this.backend.closed)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.finalized`, `this.cleanupError`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private finalize() {
    if (this.finalized || !this.childClosed || (this.backend && !this.backend.closed)) return;
    this.finalized = true;
    this.cleanupError = undefined;
    this.onFinalized(this);
  }
  /**
   * 入口 / Entry: HostWorker.send.
   * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostWorker`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostWorker`; this entry produces `void` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `failed`, `failure`, `this.child.send` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `failed`, `failure`, `this.child.send`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.child.connected`.
   * 输入 / Inputs: message: Record<string, unknown>; done: () => void optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.child.send`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `failed(error as Error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failed(error as Error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private send(message: Record<string, unknown>, done?: () => void) {
    /**
     * 入口 / Entry: HostWorker.send.failed.
     * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostWorker`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostWorker`; the calls and state transitions below complete the operation. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
     * 处理：通过 `this.fail`, `this.retire` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.fail`, `this.retire`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: error: Error
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const failed = (error: Error) => {
      this.fail(error);
      this.retire();
    };
    if (!this.child.connected) {
      failed(failure('Network worker disconnected'));
      return;
    }
    try {
      this.child.send(message, (error) => {
        if (error) failed(error);
        else done?.();
      });
    } catch (error) {
      failed(error as Error);
    }
  }
  /**
   * 入口 / Entry: HostWorker.ensureBackend.
   * 功能：核验受支持的网络后端二进制并创建本工作进程专属后端。
   * Purpose: Verifies the supported backend executable and creates this worker's owned backend.
   * 设计：二进制路径必须匹配固定发行位置；辅助进程即时准入避免持有父资源排队，失败保留清理归属。
   * Design: Executable paths match fixed distribution locations; immediate helper admission avoids waiting while holding parent resources.
   * 输入 / Inputs: binary: unknown
   * 输出 / Returns: `this.backend.id`; `id`.
   * 副作用 / Effects: `this.dependencies.spawnBackend`; `spawn`; `lease.release`; `child.stdout.setEncoding`; `this.send`; 更新 / updates `this.backendReservation`, `child`, `this.backend`.
   * 拒绝 / Refusals: 条件 / conditions `typeof binary !== 'string' || normalize(binary) !== normalize(expected)`; `this.backend`; `this.backend.closed || this.backend.binary !== binary`; 异常 / errors `failure('Invalid network backend program')`; `failure('Network backend is unavailable')`.
   * 失败处理：catch 分支执行 `lease.release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `lease.release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private ensureBackend(binary: unknown) {
    const expected = join(
      process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu'),
      `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`,
    );
    /**
     * 入口 / Entry: HostWorker.ensureBackend.normalize.
     * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `process.platform === 'win32' ? resolve(file).toLowerCase() : resolve(file)` 供上层消费（`HostWorker`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostWorker`; this entry produces `process.platform === 'win32' ? resolve(file).toLowerCase() : resolve(file)` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
     * 处理：通过 `resolve().toLowerCase`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `resolve().toLowerCase`, `resolve`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: file: string
     * 输出 / Returns: `process.platform === 'win32' ? resolve(file).toLowerCase() : resolve(file)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const normalize = (file: string) =>
      process.platform === 'win32' ? resolve(file).toLowerCase() : resolve(file);
    if (typeof binary !== 'string' || normalize(binary) !== normalize(expected))
      throw failure('Invalid network backend program');
    if (this.backend) {
      if (this.backend.closed || this.backend.binary !== binary)
        throw failure('Network backend is unavailable');
      return this.backend.id;
    }
    const lease =
      this.backendReservation ||
      (this.dependencies.governor || hostRuntime).tryAcquire({
        owner: this.options.owner || 'core:network',
        kind: 'network.backend',
        label: 'CPU-less network backend',
        lane: 'background',
        cost: { process: 1, 'network.worker': 1 },
      });
    if (!lease) throw failure('Network backend process budget is full', 'NETWORK_BUSY');
    this.backendReservation = undefined;
    let child: ChildProcess;
    try {
      const args = ['-machine', 'none', '-nodefaults', '-display', 'none', '-m', '0', '-qmp', 'stdio'];
      child = this.dependencies.spawnBackend
        ? this.dependencies.spawnBackend(binary, args)
        // On Windows libuv assigns non-detached children to its kill-on-close Job.
        // Keep that ownership: QMP stdio EOF alone does NOT terminate QEMU.
        : process.platform === 'linux'
          ? spawn('python3', [...parentExecArgs(binary), ...args],
            { detached: false, stdio: ['pipe', 'pipe', 'pipe'] })
          : spawn(binary, args, { detached: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      lease.release();
      throw error;
    }
    const id = randomUUID();
    let stopped!:
    /**
     * 中文功能：为网络后端停止 Promise 保留结算回调，供后端退出观察使用。
     * English: Retains the network-backend stop Promise settler for exit observation.
     * 所属 / Owner: HostWorker.ensureBackend.stopped.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void;
    const backend: Backend = {
      child,
      lease,
      id,
      binary,
      stopped: new Promise((done) => {
        stopped = done;
      }),
      ended: false,
      closed: false,
      writing: 0,
    };
    this.backend = backend;
    child.once('exit', () => {
      backend.ended = true;
    });
    /**
     * 入口 / Entry: HostWorker.ensureBackend.callback@303.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（child.once / close）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (child.once / close).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `lease.release`; `stopped`; `this.send`; 更新 / updates `backend.ended`, `backend.closed`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    child.once('close', () => {
      backend.ended = backend.closed = true;
      lease.release();
      stopped();
      if (this.child.connected) this.send({ command: 'backend-closed', backendId: id });
      this.finalize();
    });
    /**
     * 入口 / Entry: HostWorker.ensureBackend.failed.
     * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostWorker`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostWorker`; the calls and state transitions below complete the operation. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
     * 处理：通过 `this.fail`, `this.retire` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.fail`, `this.retire`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: error: Error
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const failed = (error: Error) => {
      this.fail(error);
      this.retire();
    };
    child.on('error', failed);
    child.stdin?.on('error', failed);
    child.stdout?.on('error', failed);
    child.stderr?.on('data', () => {});
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (bytes: string) => {
      if (this.unavailable) return;
      child.stdout!.pause();
      this.send({ command: 'backend-data', backendId: id, bytes }, () => child.stdout!.resume());
    });
    // QEMU is a direct child of this host. The worker receives only an authorized
    // control stream; it cannot spawn a backend or claim that its PID has exited.
    this.send({ command: 'backend-open', backendId: id });
    return id;
  }
  /**
   * 入口 / Entry: HostWorker.stopBackend.
   * 功能：在管理宿主网络工作进程和连接池中，结束、撤销或清理本次拥有的领域资源；本入口产生 `Promise.resolve()` / `backend.closeTask` 供上层消费（`HostWorker`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostWorker`; this entry produces `Promise.resolve()` / `backend.closeTask` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `Promise.resolve`, `inline().catch`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.resolve`, `inline().catch`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!backend || backend.closed`; `backend.closeTask`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `Promise.resolve()`; `backend.closeTask`; `(backend.closeTask = (async () => { backend.child.stdout?.resume(); if (!backend.ended) backend.child.kill('SIGKILL'); if (!(…`.
   * 副作用 / Effects: 更新 / updates `backend.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private stopBackend(): Promise<void> {
    const backend = this.backend;
    if (!backend || backend.closed) return Promise.resolve();
    if (backend.closeTask) return backend.closeTask;
    /**
     * 入口 / Entry: HostWorker.stopBackend.callback@338.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline().catch）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline().catch).
     * 输入 / Inputs: error
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `this.cleanupError`, `backend.closeTask`.
     * 拒绝 / Refusals: 异常 / errors `error`.
     */
    return (backend.closeTask = (async () => {
      backend.child.stdout?.resume();
      if (!backend.ended) backend.child.kill('SIGKILL');
      if (!(await waitForClose(backend.stopped, this.dependencies.closeTimeoutMs ?? 5000)))
        throw cleanupFailure();
    })().catch((error) => {
      backend.lease.cleanupPending(error);
      this.cleanupError = error;
      backend.closeTask = undefined;
      throw error;
    }));
  }
  /**
   * 入口 / Entry: HostWorker.fail.
   * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.unavailable`（`HostWorker`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostWorker`; the outcome is recorded in `this.unavailable`. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `this.rejectReady`, `this.pending.values`, `clearTimeout`, `pending.reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.rejectReady`, `this.pending.values`, `clearTimeout`, `pending.reject`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: error: Error
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `clearTimeout`; `this.pending.clear`; 更新 / updates `this.unavailable`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private fail(error: Error) {
    this.unavailable = true;
    this.rejectReady(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  /**
   * 入口 / Entry: HostWorker.reserve.
   * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostWorker`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostWorker`; the calls and state transitions below complete the operation. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `this.leases.add`, `this.child.ref`, `this.child.channel.ref` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.leases.add`, `this.child.ref`, `this.child.channel.ref`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.leases.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  reserve(id: string) {
    this.leases.add(id);
    this.child.ref();
    this.child.channel?.ref();
  }
  /**
   * 入口 / Entry: HostWorker.release.
   * 功能：在管理宿主网络工作进程和连接池中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`HostWorker`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostWorker`; this entry produces `void` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `this.leases.delete`, `this.child.unref`, `this.child.channel.unref` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.leases.delete`, `this.child.unref`, `this.child.channel.unref`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.leases.delete(id)`; `!this.leases.size`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.leases.delete`; 更新 / updates `this.idleAt`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  release(id: string) {
    if (!this.leases.delete(id)) return;
    if (!this.leases.size) {
      this.idleAt = Date.now();
      this.child.unref();
      this.child.channel?.unref();
    }
  }
  /**
   * 入口 / Entry: HostWorker.call.
   * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await new Promise<any>((resolve, reject) => { const timer = setTimeout(() => { this.fail(failure('Network control request tim…` 供上层消费（`HostWorker`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostWorker`; this entry produces `await new Promise<any>((resolve, reject) => { const timer = setTimeout(() => { this.fail(failure('Network control request tim…` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `signal.throwIfAborted`, `failure`, `abortable`, `this.ensureBackend` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `failure`, `abortable`, `this.ensureBackend`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `command === 'qmp'`.
   * 输入 / Inputs: command: string; data: Record<string, unknown> default={}; signal: AbortSignal optional
   * 输出 / Returns: `await new Promise<any>((resolve, reject) => { const timer = setTimeout(() => { this.fail(failure('Network control request tim…`.
   * 副作用 / Effects: `abortable`; 更新 / updates `data`.
   * 拒绝 / Refusals: 条件 / conditions `this.unavailable`; `this.inFlight >= this.options.connectionsPerWorker + 16`; `this.unavailable || !this.child.connected`; 异常 / errors `failure('Network worker is unavailable')`; `failure('Network control queue is full', 'NETWORK_BUSY')`.
   * 收尾：退出 try 区域时始终执行 `this.inFlight--;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.inFlight--;`; these steps also apply to exceptional exits.
   */
  async call(command: string, data: Record<string, unknown> = {}, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.unavailable) throw failure('Network worker is unavailable');
    if (this.inFlight >= this.options.connectionsPerWorker + 16)
      throw failure('Network control queue is full', 'NETWORK_BUSY');
    this.inFlight++;
    try {
      await (signal ? abortable(this.ready, signal) : this.ready);
      signal?.throwIfAborted();
      if (this.unavailable || !this.child.connected) throw failure('Network worker is unavailable');
      if (command === 'qmp' || command.startsWith('qmp-policy'))
        data = { ...data, backendId: this.ensureBackend(data.binary), binary: undefined };
      const requestId = randomUUID();
      /**
       * 入口 / Entry: HostWorker.call.callback@380.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `setTimeout`; `this.pending.set`; `signal.addEventListener`; `this.send`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.fail(failure('Network control request timed out', 'ETIMEDOUT'));
          this.retire();
        }, 10_000);
        /**
         * 入口 / Entry: HostWorker.call.abort.
         * 功能：在管理宿主网络工作进程和连接池中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`HostWorker`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostWorker`; the calls and state transitions below complete the operation. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
         * 处理：通过 `this.pending.delete`, `clearTimeout`, `signal.removeEventListener`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.pending.delete`, `clearTimeout`, `signal.removeEventListener`, `reject`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `this.child.connected`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `this.pending.delete`; `clearTimeout`; `this.send`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const abort = () => {
          this.pending.delete(requestId);
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          reject(signal?.reason);
          if (this.child.connected) this.send({ command: 'cancel-control', targetRequestId: requestId });
        };
        /**
         * 入口 / Entry: HostWorker.call.finish.
         * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(value: any) => { signal?.removeEventListener('abort', abort); settle(value); }` 供上层消费（`HostWorker`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostWorker`; this entry produces `(value: any) => { signal?.removeEventListener('abort', abort); settle(value); }` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
         * 处理：通过 `signal.removeEventListener`, `settle` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `signal.removeEventListener`, `settle`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: settle: (value: any) => void
         * 输出 / Returns: `(value: any) => { signal?.removeEventListener('abort', abort); settle(value); }`.
         * 副作用 / Effects: `settle`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const finish = (settle:
        /**
         * 中文功能：交付原 worker RPC 的结算值，由 finish 统一结束等待。
         * English: Delivers the original worker RPC settlement value through finish.
         * 所属 / Owner: HostWorker.call.finish.settle.
         * 输入 / Inputs: value: any.
         * 结果 / Result: `void`.
         */
        (value: any) => void) => (value: any) => {
          signal?.removeEventListener('abort', abort);
          settle(value);
        };
        this.pending.set(requestId, { resolve: finish(resolve), reject: finish(reject), timer });
        signal?.addEventListener('abort', abort, { once: true });
        this.send({ ...data, requestId, command });
      });
    } finally {
      this.inFlight--;
    }
  }
  /**
   * 入口 / Entry: HostWorker.close.
   * 功能：在管理宿主网络工作进程和连接池中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closeTask` / `(this.closeTask = Promise.resolve() .then(async () => { const timeoutMs = this.dependencies.closeTimeoutMs ?? 5000; let kill:…` 供上层消费（`HostWorker`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostWorker`; this entry produces `this.closeTask` / `(this.closeTask = Promise.resolve() .then(async () => { const timeoutMs = this.dependencies.closeTimeoutMs ?? 5000; let kill:…` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `this.fail`, `failure`, `Promise.resolve().then().catch`, `Promise.resolve().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.fail`, `failure`, `Promise.resolve().then().catch`, `Promise.resolve().then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closeTask`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.closeTask`; `(this.closeTask = Promise.resolve() .then(async () => { const timeoutMs = this.dependencies.closeTimeoutMs ?? 5000; let kill:…`.
   * 副作用 / Effects: 更新 / updates `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.fail(failure('Network worker is closed'));
    /**
     * 入口 / Entry: HostWorker.close.callback@408.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `setTimeout`; `this.send`; `this.stopBackend`; `clearTimeout`; 更新 / updates `kill`.
     * 拒绝 / Refusals: 条件 / conditions `failed?.status === 'rejected'`; 异常 / errors `failed.reason`.
     * 收尾：退出 try 区域时始终执行 `clearTimeout(kill);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `clearTimeout(kill);`; these steps also apply to exceptional exits.
     */
    return (this.closeTask = Promise.resolve()
      .then(async () => {
        const timeoutMs = this.dependencies.closeTimeoutMs ?? 5000;
        let kill: NodeJS.Timeout | undefined;
        /**
         * 入口 / Entry: HostWorker.close.terminate.
         * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostWorker`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostWorker`; this entry produces `void` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
         * 处理：通过 `this.child.kill`, `this.resource.cleanupPending` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.child.kill`, `this.resource.cleanupPending`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `this.childEnded`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `this.child.kill`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 失败处理：catch 分支执行 `this.resource.cleanupPending(error);`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `this.resource.cleanupPending(error);`; these statements determine whether a failure is absorbed or rejected again.
         */
        const terminate = () => {
          if (this.childEnded) return;
          try {
            this.child.kill('SIGKILL');
          } catch (error) {
            this.resource.cleanupPending(error);
          }
        };
        if (!this.childClosed) {
          this.child.ref();
          this.child.channel?.ref();
          kill = setTimeout(terminate, Math.min(1000, timeoutMs / 2));
          if (this.child.connected) this.send({ command: 'close' });
          else terminate();
        }
        try {
          const results = await Promise.allSettled([
            waitForClose(this.stopped, timeoutMs).then((closed) => {
              if (!closed) {
                const error = cleanupFailure();
                this.resource.cleanupPending(error);
                throw error;
              }
            }),
            this.stopBackend(),
          ]);
          const failed = results.find((result) => result.status === 'rejected');
          if (failed?.status === 'rejected') throw failed.reason;
          this.finalize();
        } finally {
          clearTimeout(kill);
        }
      })
      .catch((error) => {
        this.cleanupError = error;
        this.closeTask = undefined;
        throw error;
      }));
  }
}
/** A stream is pinned to one worker. Shrinking only reclaims completely idle workers. */
export class HostNetworkPool {
  private workers = new Set<HostWorker>();
  private sockets = new Map<string, { socket: Socket; worker: HostWorker }>();
  private pins = new Map<string, { worker: HostWorker;
  /**
   * 签名 / Signature: HostNetworkPool.failed.
   * 功能：为管理宿主网络工作进程和连接池声明 failed 的输入与结果契约，所属容器为 HostNetworkPool。
   * Purpose: Declares the input/result contract for failed in HostNetworkPool. Module responsibility: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 输入 / Inputs: error: Error
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  failed(error: Error): void }>();
  private closed = false;
  private closeTask?: Promise<void>;
  private timer: NodeJS.Timeout;
  /**
   * 入口 / Entry: HostNetworkPool.constructor.
   * 功能：建立 HostNetworkPool 的管理宿主网络工作进程和连接池上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HostNetworkPool context for this module's responsibility: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: options: PoolOptions; dependencies: PoolDependencies default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `setInterval`; 更新 / updates `this.timer`.
   * 拒绝 / Refusals: 条件 / conditions `dependencies.closeTimeoutMs !== undefined && (!Number.isSafeInteger(dependencies.closeTimeoutMs) || dependencies.closeTimeout…`; 异常 / errors `new RangeError('Invalid network close timeout')`.
   */
  constructor(
    readonly options: PoolOptions,
    private dependencies: PoolDependencies = {},
  ) {
    if (
      dependencies.closeTimeoutMs !== undefined &&
      (!Number.isSafeInteger(dependencies.closeTimeoutMs) ||
        dependencies.closeTimeoutMs < 1 ||
        dependencies.closeTimeoutMs > 2_147_483_647)
    )
      throw new RangeError('Invalid network close timeout');
    this.timer = setInterval(
      () => {
        for (const worker of this.workers)
          if (worker.available && !worker.leases.size && Date.now() - worker.idleAt >= options.idleMs)
            void worker.close().catch(() => {});
      },
      Math.max(50, Math.min(5000, options.idleMs)),
    );
    this.timer.unref();
  }
  /**
   * 入口 / Entry: HostNetworkPool.select.
   * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `worker` 供上层消费（`HostNetworkPool`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostNetworkPool`; this entry produces `worker` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `failure`, `inline.filter().sort`, `inline.filter`, `governor.tryAcquire` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `failure`, `inline.filter().sort`, `inline.filter`, `governor.tryAcquire`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.options.reserveBackend && !backendReservation`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `worker`.
   * 副作用 / Effects: `resource.release`; `this.workers.add`; `backendReservation.release`; 更新 / updates `worker`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `(!worker || worker.leases.size >= this.options.scaleAt) && this.workers.size < this.options.maxWorkers`; `resource`; 异常 / errors `failure('Network pool is closed')`; `error`.
   * 失败处理：catch 分支执行 `resource.release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `resource.release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private select(id: string) {
    if (this.closed) throw failure('Network pool is closed');
    let worker = [...this.workers]
      .filter((worker) => worker.available)
      .sort((a, b) => a.leases.size - b.leases.size)[0];
    if (
      (!worker || worker.leases.size >= this.options.scaleAt) &&
      this.workers.size < this.options.maxWorkers
    ) {
      const governor = this.dependencies.governor || hostRuntime;
      const resource = governor.tryAcquire({
        owner: this.options.owner || 'core:network',
        kind: 'network.worker',
        label: 'Network Node worker',
        lane: 'background',
        cost: { process: 1, 'network.worker': 1 },
      });
      if (resource)
        try {
          // A VM worker needs both processes. Reserve the pair before forking so the
          // last global slot cannot be stranded in an unusable supervisor.
          const backendReservation = this.options.reserveBackend
            ? governor.tryAcquire({
                owner: this.options.owner || 'core:network',
                kind: 'network.backend',
                label: 'CPU-less network backend',
                lane: 'background',
                cost: { process: 1, 'network.worker': 1 },
              })
            : undefined;
          if (this.options.reserveBackend && !backendReservation) {
            resource.release();
          } else {
            try {
              /**
               * 入口 / Entry: HostNetworkPool.select.callback@518.
               * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
               * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
               * 输入 / Inputs: dead
               * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
               * 副作用 / Effects: `entry.socket.destroy`; `this.pins.delete`; `dead.release`.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
               * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
               */
              worker = new HostWorker(
                this.options,
                resource,
                this.dependencies,
                (dead) => {
                  for (const entry of this.sockets.values())
                    if (entry.worker === dead) entry.socket.destroy(failure('Network worker exited'));
                  for (const [key, entry] of this.pins)
                    if (entry.worker === dead) {
                      this.pins.delete(key);
                      dead.release(key);
                      // One owner's failure handler must not prevent other leases being revoked.
                      try {
                        entry.failed(failure('VM network worker exited'));
                      } catch {}
                    }
                },
                (dead) => this.workers.delete(dead),
                backendReservation,
              );
              this.workers.add(worker);
            } catch (error) {
              backendReservation?.release();
              throw error;
            }
          }
        } catch (error) {
          resource.release();
          throw error;
        }
    }
    if (!worker || worker.leases.size >= this.options.connectionsPerWorker)
      throw failure('Network connection limit reached', 'NETWORK_BUSY');
    worker.reserve(id);
    return worker;
  }
  /**
   * 入口 / Entry: HostNetworkPool.start.
   * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostNetworkPool`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostNetworkPool`; the calls and state transitions below complete the operation. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `randomUUID`, `this.select`, `worker.release` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `randomUUID`, `this.select`, `worker.release`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `worker.release`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `worker.release(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `worker.release(id);`; these steps also apply to exceptional exits.
   */
  async start() {
    const id = randomUUID(),
      worker = this.select(id);
    try {
      await worker.ready;
    } finally {
      worker.release(id);
    }
  }
  /**
   * 入口 / Entry: HostNetworkPool.pin.
   * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ call: (command: string, data: Record<string, unknown>) => this.pins.has(id) ? worker.call(command, data) : Promise.reject(f…` 供上层消费（`HostNetworkPool`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostNetworkPool`; this entry produces `{ call: (command: string, data: Record<string, unknown>) => this.pins.has(id) ? worker.call(command, data) : Promise.reject(f…` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `randomUUID`, `this.select`, `this.pins.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `randomUUID`, `this.select`, `this.pins.set`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: onFailure: (error: Error) => void
   * 输出 / Returns: `{ call: (command: string, data: Record<string, unknown>) => this.pins.has(id) ? worker.call(command, data) : Promise.reject(f…`.
   * 副作用 / Effects: `this.pins.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  pin(onFailure: (error: Error) => void) {
    const id = randomUUID(),
      worker = this.select(id);
    this.pins.set(id, { worker, failed: onFailure });
    return {
      /**
       * 入口 / Entry: HostNetworkPool.pin.call.
       * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.pins.has(id) ? worker.call(command, data) : Promise.reject(failure('Network worker lease is released'))` 供上层消费（`HostNetworkPool`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostNetworkPool`; this entry produces `this.pins.has(id) ? worker.call(command, data) : Promise.reject(failure('Network worker lease is released'))` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
       * 处理：通过 `this.pins.has`, `worker.call`, `Promise.reject`, `failure` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.pins.has`, `worker.call`, `Promise.reject`, `failure`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: command: string; data: Record<string, unknown>
       * 输出 / Returns: `this.pins.has(id) ? worker.call(command, data) : Promise.reject(failure('Network worker lease is released'))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      call: (command: string, data: Record<string, unknown>) =>
        this.pins.has(id)
          ? worker.call(command, data)
          : Promise.reject(failure('Network worker lease is released')),
      /**
       * 入口 / Entry: HostNetworkPool.pin.release.
       * 功能：在管理宿主网络工作进程和连接池中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`HostNetworkPool`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostNetworkPool`; the calls and state transitions below complete the operation. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
       * 处理：通过 `this.pins.delete`, `worker.release` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.pins.delete`, `worker.release`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.pins.delete`; `worker.release`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      release: () => {
        this.pins.delete(id);
        worker.release(id);
      },
      /**
       * 入口 / Entry: HostNetworkPool.pin.terminate.
       * 功能：把本层请求转交 `worker.close`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `worker.close` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `worker.close()`.
       * 副作用 / Effects: `worker.close`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      terminate: () => worker.close(),
      /**
       * 入口 / Entry: HostNetworkPool.pin.resources.
       * 功能：从当前输入或状态计算 `({ worker: worker.resource.id, backend: worker.backendResourceId })`，供调用方后续验证或使用。
       * Purpose: Computes `({ worker: worker.resource.id, backend: worker.backendResourceId })` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `({ worker: worker.resource.id, backend: worker.backendResourceId })`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      resources: () => ({ worker: worker.resource.id, backend: worker.backendResourceId }),
    };
  }
  /**
   * 入口 / Entry: HostNetworkPool.dial.
   * 功能：选择或固定网络工作进程，按期限建立到已核定目标的连接。
   * Purpose: Selects/pins a network worker and opens a deadline-bound connection to the approved destination.
   * 设计：调用、期限与作用域取消组合；连接交付前重查目标和关闭状态，失败关闭原 socket 和工作租约。
   * Design: Caller/deadline/scope cancellation combine; handoff rechecks target/closure and failure closes original sockets/worker leases.
   * 输入 / Inputs: destination: Destination; signal: AbortSignal optional; timeoutMs: default=10_000
   * 输出 / Returns: Promise<Socket>；结果来自 / values from `socket`.
   * 副作用 / Effects: `setTimeout`; `AbortSignal.any`; `signal.addEventListener`; `abortable`; `connectingSignal.throwIfAborted`; 更新 / updates `socket`.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647`; 异常 / errors `new RangeError('Invalid network timeout')`; `error`.
   * 失败处理：catch 分支执行 `clearTimeout(timer);`; `cancel();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `clearTimeout(timer);`; `cancel();`; these statements determine whether a failure is absorbed or rejected again.
   */
  async dial(destination: Destination, signal?: AbortSignal, timeoutMs = 10_000): Promise<Socket> {
    signal?.throwIfAborted();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
      throw new RangeError('Invalid network timeout');
    const id = randomUUID(),
      worker = this.select(id);
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(failure('Network connection timed out', 'ETIMEDOUT')),
      Math.ceil(timeoutMs),
    );
    const connectingSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    let socket: Socket | undefined;
    /**
     * 入口 / Entry: HostNetworkPool.dial.cancel.
     * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostNetworkPool`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostNetworkPool`; the calls and state transitions below complete the operation. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
     * 处理：通过 `socket.destroy`, `worker.call().catch`, `worker.call` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `socket.destroy`, `worker.call().catch`, `worker.call`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `socket.destroy`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const cancel = () => {
      socket?.destroy();
      void worker.call('cancel', { id }).catch(() => {});
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const ticket = await abortable(worker.call('open', { id, destination, timeoutMs }), connectingSignal);
      connectingSignal.throwIfAborted();
      const port = await worker.ready;
      socket = createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
      this.sockets.set(id, { socket, worker });
      socket.setNoDelay();
      socket.once('close', () => {
        this.sockets.delete(id);
        worker.release(id);
        signal?.removeEventListener('abort', cancel);
      });
      /**
       * 入口 / Entry: HostNetworkPool.dial.callback@606.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `connectingSignal.addEventListener`; `aborted`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      await new Promise<void>((resolve, reject) => {
        let input = Buffer.alloc(0),
          settled = false;
        /**
         * 入口 / Entry: HostNetworkPool.dial.done.
         * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostNetworkPool`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostNetworkPool`; this entry produces `void` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
         * 处理：通过 `connectingSignal.removeEventListener`, `inline.off`, `reject`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `connectingSignal.removeEventListener`, `inline.off`, `reject`, `resolve`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `settled`.
         * 输入 / Inputs: error: unknown optional
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `connectingSignal.removeEventListener`; 更新 / updates `settled`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const done = (error?: unknown) => {
          if (settled) return;
          settled = true;
          connectingSignal.removeEventListener('abort', aborted);
          socket!.off('data', data);
          socket!.off('error', done);
          socket!.off('close', closed);
          socket!.off('connect', connected);
          error ? reject(error) : resolve();
        };
        /**
         * 入口 / Entry: HostNetworkPool.dial.aborted.
         * 功能：把本层请求转交 `done`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `done` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `done(connectingSignal.reason)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const aborted = () => done(connectingSignal.reason);
        /**
         * 入口 / Entry: HostNetworkPool.dial.closed.
         * 功能：在管理宿主网络工作进程和连接池中，结束、撤销或清理本次拥有的领域资源；本入口产生 `done(connectingSignal.aborted ? connectingSignal.reason : failure('Network connection closed'))` 供上层消费（`HostNetworkPool`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostNetworkPool`; this entry produces `done(connectingSignal.aborted ? connectingSignal.reason : failure('Network connection closed'))` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
         * 处理：通过 `done`, `failure` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `done`, `failure`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `done(connectingSignal.aborted ? connectingSignal.reason : failure('Network connection closed'))`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const closed = () =>
          done(connectingSignal.aborted ? connectingSignal.reason : failure('Network connection closed'));
        /**
         * 入口 / Entry: HostNetworkPool.dial.connected.
         * 功能：把本层请求转交 `inline.write`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `inline.write` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `socket!.write(JSON.stringify({ id, token: ticket.token }) + '\n')`.
         * 副作用 / Effects: `inline.write`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const connected = () => socket!.write(JSON.stringify({ id, token: ticket.token }) + '\n');
        /**
         * 入口 / Entry: HostNetworkPool.dial.data.
         * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `done(failure('Invalid network handshake'))` / `void` 供上层消费（`HostNetworkPool`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostNetworkPool`; this entry produces `done(failure('Invalid network handshake'))` / `void` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
         * 处理：通过 `input.indexOf`, `done`, `failure`, `inline.pause` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `input.indexOf`, `done`, `failure`, `inline.pause`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `end > 4096 || (end < 0 && input.length > 4096)`; `end < 0`; `!message.ok`.
         * 输入 / Inputs: chunk: Buffer
         * 输出 / Returns: `done(failure('Invalid network handshake'))`; `void`; `done(failure(message.error?.message || 'Connection failed', message.error?.code))`.
         * 副作用 / Effects: `inline.unshift`; 更新 / updates `input`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 失败处理：catch 分支执行 `done(failure('Invalid network handshake'));`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `done(failure('Invalid network handshake'));`; these statements determine whether a failure is absorbed or rejected again.
         */
        const data = (chunk: Buffer) => {
          input = Buffer.concat([input, chunk]);
          const end = input.indexOf(10);
          if (end > 4096 || (end < 0 && input.length > 4096))
            return done(failure('Invalid network handshake'));
          if (end < 0) return;
          socket!.pause();
          try {
            const message = JSON.parse(input.subarray(0, end).toString());
            if (!message.ok)
              return done(failure(message.error?.message || 'Connection failed', message.error?.code));
            const remaining = input.subarray(end + 1);
            if (remaining.length) socket!.unshift(remaining);
            done();
          } catch {
            done(failure('Invalid network handshake'));
          }
        };
        socket!.on('error', done);
        socket!.once('close', closed);
        socket!.on('data', data);
        socket!.once('connect', connected);
        connectingSignal.addEventListener('abort', aborted, { once: true });
        if (connectingSignal.aborted) aborted();
      });
      connectingSignal.throwIfAborted();
      clearTimeout(timer);
      return socket;
    } catch (error) {
      clearTimeout(timer);
      cancel();
      worker.release(id);
      signal?.removeEventListener('abort', cancel);
      throw error;
    }
  }
  /**
   * 入口 / Entry: HostNetworkPool.lookup.
   * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await worker.call('lookup', { hostname, options }, signal)` 供上层消费（`HostNetworkPool`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostNetworkPool`; this entry produces `await worker.call('lookup', { hostname, options }, signal)` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `signal.throwIfAborted`, `randomUUID`, `this.select`, `worker.call` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `randomUUID`, `this.select`, `worker.call`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: hostname: string; options: Record<string, unknown>; signal: AbortSignal optional
   * 输出 / Returns: `await worker.call('lookup', { hostname, options }, signal)`.
   * 副作用 / Effects: `worker.release`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `worker.release(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `worker.release(id);`; these steps also apply to exceptional exits.
   */
  async lookup(hostname: string, options: Record<string, unknown>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const id = randomUUID(),
      worker = this.select(id);
    try {
      return await worker.call('lookup', { hostname, options }, signal);
    } finally {
      worker.release(id);
    }
  }
  /**
   * 入口 / Entry: HostNetworkPool.snapshot.
   * 功能：从当前输入或状态计算 `[...this.workers].map((worker) => ({ pid: worker.child.pid, backendPid: worker.backendPid, resourceId: worker.resource.id, ba…`，供调用方后续验证或使用。
   * Purpose: Computes `[...this.workers].map((worker) => ({ pid: worker.child.pid, backendPid: worker.backendPid, resourceId: worker.resource.id, ba…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `[...this.workers].map((worker) => ({ pid: worker.child.pid, backendPid: worker.backendPid, resourceId: worker.resource.id, ba…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  snapshot() {
    return [...this.workers].map((worker) => ({
      pid: worker.child.pid,
      backendPid: worker.backendPid,
      resourceId: worker.resource.id,
      backendResourceId: worker.backendResourceId,
      state: worker.cleanupError ? 'cleanup-pending' : worker.available ? 'active' : 'closing',
      cleanupError: worker.cleanupError?.message,
      connections: worker.leases.size,
    }));
  }
  /**
   * 入口 / Entry: HostNetworkPool.close.
   * 功能：在管理宿主网络工作进程和连接池中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closeTask` / `(this.closeTask = (async () => { this.closed = true; clearInterval(this.timer); for (const { socket } of this.sockets.values(…` 供上层消费（`HostNetworkPool`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostNetworkPool`; this entry produces `this.closeTask` / `(this.closeTask = (async () => { this.closed = true; clearInterval(this.timer); for (const { socket } of this.sockets.values(…` for its caller. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `inline().catch`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline().catch`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closeTask`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.closeTask`; `(this.closeTask = (async () => { this.closed = true; clearInterval(this.timer); for (const { socket } of this.sockets.values(…`.
   * 副作用 / Effects: 更新 / updates `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    /**
     * 入口 / Entry: HostNetworkPool.close.callback@682.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `clearInterval`; `socket.destroy`; 更新 / updates `this.closed`.
     * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `cleanupFailure()`.
     */
    return (this.closeTask = (async () => {
      this.closed = true;
      clearInterval(this.timer);
      for (const { socket } of this.sockets.values()) socket.destroy();
      const results = await Promise.allSettled([...this.workers].map((worker) => worker.close()));
      const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
      if (errors.length) throw cleanupFailure();
    })().catch((error) => {
      this.closeTask = undefined;
      throw error;
    }));
  }
  /** Retries only this pool's retained original ChildProcess handles, never a supplied PID. */
  /**
   * 入口 / Entry: HostNetworkPool.retryCleanup.
   * 功能：在管理宿主网络工作进程和连接池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostNetworkPool`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostNetworkPool`; the calls and state transitions below complete the operation. Module context: Owns host network workers and connection pools, pinning targets and retaining leases for cleanup retry.
   * 处理：通过 `inline.find`, `failure`, `worker.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.find`, `failure`, `worker.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: resourceId: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `worker.close`.
   * 拒绝 / Refusals: 条件 / conditions `!worker`; 异常 / errors `failure('Unknown network resource', 'NETWORK_RESOURCE_NOT_FOUND')`.
   */
  async retryCleanup(resourceId: string) {
    const worker = [...this.workers].find(
      (worker) => worker.resource.id === resourceId || worker.backendResourceId === resourceId,
    );
    if (!worker) throw failure('Unknown network resource', 'NETWORK_RESOURCE_NOT_FOUND');
    await worker.close();
  }
}
