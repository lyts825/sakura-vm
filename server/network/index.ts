/**
 * 模块职责：提供按所有者划分的网络作用域，封装请求、代理环境和连接资源生命周期。
 * Module purpose: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Agent as FetchAgent } from 'undici';
import { WebSocket } from 'ws';
import { networkRuntime, type NetworkIdentity, type NetworkRuntime } from './core.ts';
import type { Destination } from './host-pool.ts';
import { withPluginAuthority, withPluginBackground, pluginAuthority } from '../plugin-authority.ts';
import type { PluginInstance } from '../plugin-instance.ts';
import { withResourceContext } from '../host-runtime/context.ts';
export { networkRuntime, NetworkRuntime, networkDefaults } from './core.ts';
export type { NetworkIdentity } from './core.ts';
export type { VmNetworkLease } from './vm-backend.ts';

/** Host-issued capability: consumers cannot change its owner or grant themselves another generation. */
/**
 * 入口 / Entry: NetworkScope.callback@52.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
 * 输入 / Inputs: args: any[]
 * 输出 / Returns: `socket`.
 * 副作用 / Effects: `this.abort.signal.throwIfAborted`; `this.runtime.connectLocal`; `this.abort.signal.addEventListener`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export class NetworkScope {
  readonly identity: NetworkIdentity;
  private abort = new AbortController();
  private fetchAgent?: FetchAgent;
  private agents = new Set<http.Agent>();
  /**
   * 签名 / Signature: NetworkScope.release.
   * 功能：为提供按所有者划分的网络作用域声明 release 的输入与结果契约，所属容器为 NetworkScope。
   * Purpose: Declares the input/result contract for release in NetworkScope. Module responsibility: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private release: () => void;
  /**
   * 签名 / Signature: NetworkScope.detachParent.
   * 功能：为提供按所有者划分的网络作用域声明 detachParent 的输入与结果契约，所属容器为 NetworkScope。
   * Purpose: Declares the input/result contract for detachParent in NetworkScope. Module responsibility: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private detachParent?: () => void;
  private closeTask?: Promise<void>;
  /**
   * 入口 / Entry: NetworkScope.constructor.
   * 功能：建立 NetworkScope 的提供按所有者划分的网络作用域上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the NetworkScope context for this module's responsibility: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: identity: NetworkIdentity; runtime: NetworkRuntime; signal: AbortSignal optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `this.close().catch`; `this.close`; `signal.addEventListener`; 更新 / updates `this.identity`, `this.release`, `this.detachParent`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    identity: NetworkIdentity,
    private runtime: NetworkRuntime,
    signal?: AbortSignal,
  ) {
    this.identity = Object.freeze({ ...identity, scopeId: randomUUID() });
    this.release = runtime.own(() => this.close());
    if (signal?.aborted) void this.close(signal.reason).catch(() => {});
    else if (signal) {
      /**
       * 入口 / Entry: NetworkScope.constructor.close.
       * 功能：在提供按所有者划分的网络作用域中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`NetworkScope`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `NetworkScope`; the calls and state transitions below complete the operation. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
       * 处理：通过 `this.close().catch`, `this.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.close().catch`, `this.close`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.close().catch`; `this.close`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const close = () => {
        void this.close(signal.reason).catch(() => {});
      };
      signal.addEventListener('abort', close, { once: true });
      /**
       * 入口 / Entry: NetworkScope.constructor.this.detachParent.
       * 功能：把本层请求转交 `signal.removeEventListener`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `signal.removeEventListener` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `signal.removeEventListener('abort', close)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      this.detachParent = () => signal.removeEventListener('abort', close);
    }
  }
  /**
   * 入口 / Entry: NetworkScope.signal.
   * 功能：从当前输入或状态计算 `signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal`，供调用方后续验证或使用。
   * Purpose: Computes `signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: `signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal`.
   * 副作用 / Effects: `AbortSignal.any`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private signal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal;
  }
  /**
   * 入口 / Entry: NetworkScope.dial.
   * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.runtime.dial(this.identity, destination, this.signal(signal), timeoutMs)` 供上层消费（`NetworkScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; this entry produces `this.runtime.dial(this.identity, destination, this.signal(signal), timeoutMs)` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
   * 处理：通过 `this.abort.signal.throwIfAborted`, `this.runtime.dial`, `this.signal` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.abort.signal.throwIfAborted`, `this.runtime.dial`, `this.signal`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: destination: Destination; signal: AbortSignal optional; timeoutMs: number optional
   * 输出 / Returns: `this.runtime.dial(this.identity, destination, this.signal(signal), timeoutMs)`.
   * 副作用 / Effects: `this.abort.signal.throwIfAborted`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  dial = (destination: Destination, signal?: AbortSignal, timeoutMs?: number) => {
    this.abort.signal.throwIfAborted();
    return this.runtime.dial(this.identity, destination, this.signal(signal), timeoutMs);
  };
  connectLocal: typeof net.createConnection = ((...args: any[]) => {
    this.abort.signal.throwIfAborted();
    // The project's local callers use object or IPC path forms. Numeric forms are normalized here.
    const options =
      typeof args[0] === 'string'
        ? { path: args[0] }
        : typeof args[0] === 'number'
          ? { port: args[0], host: typeof args[1] === 'string' ? args[1] : '127.0.0.1' }
          : args[0];
    const socket = this.runtime.connectLocal(this.identity, options);
    /**
     * 入口 / Entry: NetworkScope.abort.
     * 功能：把本层请求转交 `socket.destroy`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `socket.destroy` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `socket.destroy()`.
     * 副作用 / Effects: `socket.destroy`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abort = () => socket.destroy();
    this.abort.signal.addEventListener('abort', abort, { once: true });
    socket.once('close', () => this.abort.signal.removeEventListener('abort', abort));
    const callback = args.find((arg) => typeof arg === 'function');
    if (callback) socket.once('connect', callback);
    return socket;
  }) as typeof net.createConnection;
  /**
   * 入口 / Entry: NetworkScope.manageServer.
   * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.runtime.manageServer(this.identity, server, this.abort.signal)` 供上层消费（`NetworkScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; this entry produces `this.runtime.manageServer(this.identity, server, this.abort.signal)` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
   * 处理：通过 `this.abort.signal.throwIfAborted`, `this.runtime.manageServer` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.abort.signal.throwIfAborted`, `this.runtime.manageServer`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: server: T
   * 输出 / Returns: `this.runtime.manageServer(this.identity, server, this.abort.signal)`.
   * 副作用 / Effects: `this.abort.signal.throwIfAborted`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  manageServer = <T extends net.Server>(server: T) => {
    this.abort.signal.throwIfAborted();
    return this.runtime.manageServer(this.identity, server, this.abort.signal);
  };
  createServer: typeof net.createServer = ((...args: Parameters<typeof net.createServer>) =>
    this.manageServer(net.createServer(...args))) as typeof net.createServer;
  createHttpServer: typeof http.createServer = ((...args: Parameters<typeof http.createServer>) =>
    this.manageServer(http.createServer(...args))) as typeof http.createServer;
  createHttpsServer: typeof https.createServer = ((...args: Parameters<typeof https.createServer>) =>
    this.manageServer(https.createServer(...args))) as typeof https.createServer;
  /**
   * 入口 / Entry: NetworkScope.lookup.
   * 功能：把本层请求转交 `this.runtime.lookup`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.runtime.lookup` and propagates the provider result or rejection.
   * 输入 / Inputs: hostname: string; options: { family?: number } default={}
   * 输出 / Returns: `this.runtime.lookup(this.identity, hostname, options, this.abort.signal) as Promise<{ address: string; family: number; }>`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  lookup = (hostname: string, options: { family?: number } = {}) =>
    this.runtime.lookup(this.identity, hostname, options, this.abort.signal) as Promise<{
      address: string;
      family: number;
    }>;
  /**
   * 入口 / Entry: NetworkScope.makeAgent.
   * 功能：构造受作用域约束的 HTTP Agent，把每次连接申请放入网络治理层。
   * Purpose: Builds a scope-bound HTTP Agent that submits each connection to network governance.
   * 设计：拒绝调用方直接提供 socket 或本地路径绕过目标检查；请求销毁、准入和连接交付按同一原请求关联。
   * Design: Caller sockets/local paths cannot bypass target checks; destruction/admission/socket delivery stay tied to the original request.
   * 输入 / Inputs: secure: boolean; oneShot: default=false
   * 输出 / Returns: `agent`.
   * 副作用 / Effects: `this.abort.signal.throwIfAborted`; `agent.addRequest.bind`; `this.agents.add`; `agent.destroy.bind`; 更新 / updates `agent.addRequest`, `agent.createConnection`, `agent.destroy`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private makeAgent(secure: boolean, oneShot = false) {
    this.abort.signal.throwIfAborted();
    const connecting = new Set<AbortController>();
    const requests = new Set<http.ClientRequest>();
    const requestAbort = Symbol('managed request cancellation');
    const config = { keepAlive: !oneShot, maxSockets: 64, maxTotalSockets: 64, maxFreeSockets: 4 };
    const agent = (secure ? new https.Agent(config) : new http.Agent(config)) as http.Agent & {
      /**
       * 签名 / Signature: NetworkScope.makeAgent.addRequest.
       * 功能：为提供按所有者划分的网络作用域声明 addRequest 的输入与结果契约，所属容器为 NetworkScope.makeAgent。
       * Purpose: Declares the input/result contract for addRequest in NetworkScope.makeAgent. Module responsibility: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
       * 输入 / Inputs: request: http.ClientRequest; options: http.RequestOptions
       * 输出 / Returns: void.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      addRequest(request: http.ClientRequest, options: http.RequestOptions): void;
    };
    let destroyed = false;
    /**
     * 入口 / Entry: NetworkScope.makeAgent.stopped.
     * 功能：从当前输入或状态计算 `Object.assign(new Error('Managed HTTP transport is closed'), { code: 'NETWORK_UNAVAILABLE' })`，供调用方后续验证或使用。
     * Purpose: Computes `Object.assign(new Error('Managed HTTP transport is closed'), { code: 'NETWORK_UNAVAILABLE' })` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `Object.assign(new Error('Managed HTTP transport is closed'), { code: 'NETWORK_UNAVAILABLE' })`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    const stopped = () =>
      Object.assign(new Error('Managed HTTP transport is closed'), { code: 'NETWORK_UNAVAILABLE' });
    /**
     * 入口 / Entry: NetworkScope.makeAgent.failRequest.
     * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NetworkScope`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; the calls and state transitions below complete the operation. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
     * 处理：通过 `inline.onSocket` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `inline.onSocket`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: request: http.ClientRequest; error: Error
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const failRequest = (request: http.ClientRequest, error: Error) => {
      // This is the same completion path Node's Agent uses when createConnection
      // fails. A queued request has no socket whose destruction could complete it.
      (request as http.ClientRequest & {
      /**
       * 签名 / Signature: NetworkScope.makeAgent.onSocket.
       * 功能：为提供按所有者划分的网络作用域声明 onSocket 的输入与结果契约，所属容器为 NetworkScope.makeAgent。
       * Purpose: Declares the input/result contract for onSocket in NetworkScope.makeAgent. Module responsibility: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
       * 输入 / Inputs: socket: null; error: Error
       * 输出 / Returns: void.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      onSocket(socket: null, error: Error): void }).onSocket(null, error);
    };
    const addRequest = agent.addRequest.bind(agent);
    /**
     * 入口 / Entry: NetworkScope.makeAgent.agent.addRequest.
     * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`NetworkScope`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; this entry produces `void` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
     * 处理：通过 `failRequest`, `stopped`, `requests.add`, `request.once` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `failRequest`, `stopped`, `requests.add`, `request.once`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `destroyed || this.abort.signal.aborted`; `requests.size >= this.runtime.options.maxOwnerConnections`.
     * 输入 / Inputs: request; options
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `stopped`; `requests.add`; `request.once`; `addRequest`; `requests.delete`; 更新 / updates `request.destroy`.
     * 拒绝 / Refusals: 异常 / errors `error`.
     * 失败处理：catch 分支执行 `requests.delete(request);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `requests.delete(request);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    agent.addRequest = (request, options) => {
      if (destroyed || this.abort.signal.aborted) {
        failRequest(request, stopped());
        return;
      }
      if (requests.size >= this.runtime.options.maxOwnerConnections) {
        failRequest(
          request,
          Object.assign(new Error('Managed HTTP request limit reached'), { code: 'NETWORK_BUSY' }),
        );
        return;
      }
      const abort = new AbortController();
      requests.add(request);
      request.once('close', () => requests.delete(request));
      const destroy = request.destroy;
      /**
       * 入口 / Entry: NetworkScope.makeAgent.request.destroy.
       * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`NetworkScope`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; this entry produces `result` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
       * 处理：通过 `destroy.call`, `abort.abort`, `queued.indexOf`, `inline.splice` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `destroy.call`, `abort.abort`, `queued.indexOf`, `inline.splice`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!queued`; `index < 0`; `!queued.length`.
       * 输入 / Inputs: error: Error optional
       * 输出 / Returns: `result`.
       * 副作用 / Effects: `destroy.call`; `abort.abort`; `inline.splice`; `stopped`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      request.destroy = (error?: Error) => {
        const result = destroy.call(request, error);
        abort.abort(error);
        // Agent.destroy() does not empty its pending queue. Remove revoked
        // requests so a later free socket cannot silently revive them.
        for (const [key, queued] of Object.entries(agent.requests)) {
          if (!queued) continue;
          const index = queued.indexOf(request);
          if (index < 0) continue;
          (queued as http.ClientRequest[]).splice(index, 1);
          if (!queued.length) delete (agent.requests as Record<string, http.ClientRequest[]>)[key];
          failRequest(request, error || stopped());
          break;
        }
        return result;
      };
      try {
        addRequest(request, { ...options, [requestAbort]: abort } as http.RequestOptions);
      } catch (error) {
        requests.delete(request);
        throw error;
      }
    };
    /**
     * 入口 / Entry: NetworkScope.makeAgent.callback@141.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: options: tls.ConnectionOptions & { host: string; port: number; family?: number; [requestAbort]…; callback: (error: Error | null, socket?: net.Socket) => void
     * 输出 / Returns: `undefined`.
     * 副作用 / Effects: `connecting.add`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    agent.createConnection = ((
      options: tls.ConnectionOptions & {
        host: string;
        port: number;
        family?: number;
        [requestAbort]?: AbortController;
      },
      callback:
      /**
       * 中文功能：将连接错误或已建立 socket 交付给 HTTP agent 的连接完成通道。
       * English: Delivers a connection error or established socket to the HTTP agent connection-completion channel.
       * 所属 / Owner: NetworkScope.makeAgent.callback.
       * 输入 / Inputs: error: Error | null; socket?: net.Socket.
       * 结果 / Result: `void`.
       */
      (error: Error | null, socket?: net.Socket) => void,
    ) => {
      const abort = options[requestAbort] || new AbortController();
      connecting.add(abort);
      /**
       * 入口 / Entry: NetworkScope.makeAgent.callback@163.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then().then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then().then).
       * 输入 / Inputs: socket
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `connecting.delete`; `tls.connect`; `socket.destroy`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       * 失败处理：catch 分支执行 `socket.destroy();`; `callback(error as Error);`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `socket.destroy();`; `callback(error as Error);`; these statements determine whether a failure is absorbed or rejected again.
       */
      void Promise.resolve()
        .then(() => {
          if (destroyed) throw stopped();
          if (options.socket || (options as http.RequestOptions).socketPath)
            throw new Error('Custom HTTP sockets are not supported');
          return this.dial(
            { host: options.host, port: Number(options.port), family: options.family },
            abort.signal,
          );
        })
        .then(
          (socket) => {
            connecting.delete(abort);
            if (secure) {
              // TLS stays at the protocol adapter so existing CA/mTLS/pinning checks retain their meaning.
              try {
                const encrypted = tls.connect({
                  ...options,
                  socket,
                  servername: options.servername ?? (net.isIP(options.host) ? undefined : options.host),
                });
                callback(null, encrypted);
              } catch (error) {
                socket.destroy();
                callback(error as Error);
              }
            } else {
              callback(null, socket);
              socket.resume();
            }
          },
          (error) => {
            connecting.delete(abort);
            callback(error);
          },
        );
      return undefined;
    }) as typeof agent.createConnection;
    this.agents.add(agent);
    const destroy = agent.destroy.bind(agent);
    /**
     * 入口 / Entry: NetworkScope.makeAgent.agent.destroy.
     * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`NetworkScope`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; this entry produces `void` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
     * 处理：通过 `request.destroy`, `stopped`, `requests.clear`, `abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `request.destroy`, `stopped`, `requests.clear`, `abort.abort`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `destroyed`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `request.destroy`; `stopped`; `requests.clear`; `abort.abort`; `connecting.clear`; 更新 / updates `destroyed`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    agent.destroy = () => {
      if (destroyed) return;
      destroyed = true;
      for (const request of requests) request.destroy(stopped());
      requests.clear();
      for (const abort of connecting) abort.abort();
      connecting.clear();
      this.agents.delete(agent);
      destroy();
    };
    return agent;
  }
  /** Smithy/AWS accepts these explicit transports instead of constructing an unmanaged default. */
  /**
   * 入口 / Entry: NetworkScope.requestHandler.
   * 功能：从当前输入或状态计算 `({ httpAgent: this.makeAgent(false), httpsAgent: this.makeAgent(true) })`，供调用方后续验证或使用。
   * Purpose: Computes `({ httpAgent: this.makeAgent(false), httpsAgent: this.makeAgent(true) })` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `({ httpAgent: this.makeAgent(false), httpsAgent: this.makeAgent(true) })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  requestHandler = () => ({ httpAgent: this.makeAgent(false), httpsAgent: this.makeAgent(true) });
  /** Scoped HTTP CONNECT proxy for tools such as Git/npm that expose proxy configuration. */
  /**
   * 入口 / Entry: NetworkScope.proxyEnvironment.
   * 功能：建立仅本次租约可认证的本机 HTTP/CONNECT 代理并返回代理环境变量。
   * Purpose: Creates a lease-authenticated loopback HTTP/CONNECT proxy and returns proxy environment settings.
   * 设计：nonce 凭证限制访问，目标解析和连接继续走受管网络；作用域关闭销毁监听和全部原请求。
   * Design: Nonce credentials restrict access, target resolution/dialing remain managed and scope close destroys listeners/original requests.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ env: { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, all_proxy: proxy, NO…`.
   * 副作用 / Effects: `this.createHttpServer`; `server.address`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async proxyEnvironment() {
    const password = randomBytes(32).toString('hex');
    const expected = Buffer.from('Basic ' + Buffer.from('sakura:' + password).toString('base64'));
    /**
     * 入口 / Entry: NetworkScope.proxyEnvironment.authorized.
     * 功能：从当前输入或状态计算 `actual.length === expected.length && timingSafeEqual(actual, expected)`，供调用方后续验证或使用。
     * Purpose: Computes `actual.length === expected.length && timingSafeEqual(actual, expected)` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: request: http.IncomingMessage
     * 输出 / Returns: `actual.length === expected.length && timingSafeEqual(actual, expected)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const authorized = (request: http.IncomingMessage) => {
      const actual = Buffer.from(String(request.headers['proxy-authorization'] || ''));
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    };
    /**
     * 入口 / Entry: NetworkScope.proxyEnvironment.callback@214.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.createHttpServer）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.createHttpServer).
     * 输入 / Inputs: request; response
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `response.writeHead`; `request.pipe`; 更新 / updates `url`.
     * 拒绝 / Refusals: 条件 / conditions `url.protocol !== 'http:' || url.username || url.password`; 异常 / errors `new Error()`.
     * 失败处理：catch 分支执行 `response.writeHead(400);`; `response.end();`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `response.writeHead(400);`; `response.end();`; these statements determine whether a failure is absorbed or rejected again.
     */
    const server = this.createHttpServer({ maxHeaderSize: 8192 }, (request, response) => {
      if (!authorized(request)) {
        response.writeHead(407);
        response.end();
        return;
      }
      let url: URL;
      try {
        url = new URL(request.url || '');
        if (url.protocol !== 'http:' || url.username || url.password) throw new Error();
      } catch {
        response.writeHead(400);
        response.end();
        return;
      }
      const headers: http.OutgoingHttpHeaders = { ...request.headers, host: url.host };
      for (const name of [
        'proxy-authorization',
        'proxy-connection',
        'connection',
        'keep-alive',
        'transfer-encoding',
        'te',
        'trailer',
        'upgrade',
        ...String(request.headers.connection || '')
          .toLowerCase()
          .split(','),
      ])
        delete headers[name.trim()];
      const abort = new AbortController();
      response.once('close', () => abort.abort());
      try {
        const upstream = this.httpRequest(
          url,
          { method: request.method, headers, signal: abort.signal },
          (reply) => {
            response.writeHead(reply.statusCode || 502, reply.headers);
            reply.pipe(response);
            reply.on('error', () => response.destroy());
          },
        );
        upstream.on('error', () => {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
        request.pipe(upstream);
      } catch {
        response.writeHead(502);
        response.end();
      }
    });
    /**
     * 入口 / Entry: NetworkScope.proxyEnvironment.callback@266.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（server.on / connect）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (server.on / connect).
     * 输入 / Inputs: request; socket; head
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `url.hostname.replace`; 更新 / updates `destination`.
     * 拒绝 / Refusals: 条件 / conditions `!/^(?:\[[0-9a-f:.]+\]|[^:/?#@\s]+):[0-9]+$/i.test(request.url || '')`; `url.username || url.password || url.pathname !== '/' || url.search || url.hash`; 异常 / errors `new Error()`.
     * 失败处理：catch 分支执行 `socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');`; `return;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');`; `return;`; these statements determine whether a failure is absorbed or rejected again.
     */
    server.on('connect', (request, socket, head) => {
      socket.on('error', () => {});
      if (!authorized(request)) {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
        return;
      }
      let destination: Destination;
      try {
        if (!/^(?:\[[0-9a-f:.]+\]|[^:/?#@\s]+):[0-9]+$/i.test(request.url || '')) throw new Error();
        const url = new URL('http://' + request.url);
        if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
        destination = { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 80) };
      } catch {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      socket.pause();
      const abort = new AbortController();
      socket.once('close', () => abort.abort());
      /**
       * 入口 / Entry: NetworkScope.proxyEnvironment.callback@288.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then().then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then().then).
       * 输入 / Inputs: upstream
       * 输出 / Returns: `upstream.destroy()`.
       * 副作用 / Effects: `upstream.destroy`; `socket.write`; `upstream.write`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      void Promise.resolve()
        .then(() => this.dial(destination, abort.signal))
        .then(
          (upstream) => {
            if (socket.destroyed) return upstream.destroy();
            upstream.on('error', () => socket.destroy());
            upstream.once('close', () => socket.destroy());
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) upstream.write(head);
            socket.pipe(upstream);
            upstream.pipe(socket);
            socket.resume();
            upstream.resume();
          },
          () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'),
        );
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address() as net.AddressInfo;
    const proxy = `http://sakura:${password}@127.0.0.1:${address.port}`;
    return {
      env: {
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        ALL_PROXY: proxy,
        http_proxy: proxy,
        https_proxy: proxy,
        all_proxy: proxy,
        NO_PROXY: '',
        no_proxy: '',
        npm_config_proxy: proxy,
        npm_config_https_proxy: proxy,
      },
      /**
       * 入口 / Entry: NetworkScope.proxyEnvironment.close.
       * 功能：把本层请求转交 `this.runtime.closeServer`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.runtime.closeServer` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.runtime.closeServer(server)`.
       * 副作用 / Effects: `this.runtime.closeServer`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      close: () => this.runtime.closeServer(server),
    };
  }
  /**
   * 入口 / Entry: NetworkScope.webSocket.
   * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `socket` 供上层消费（`NetworkScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; this entry produces `socket` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
   * 处理：通过 `this.abort.signal.throwIfAborted`, `this.runtime.check`, `inline.includes`, `this.makeAgent` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.abort.signal.throwIfAborted`, `this.runtime.check`, `inline.includes`, `this.makeAgent`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: url: string; options: WebSocket.ClientOptions default={}
   * 输出 / Returns: `socket`.
   * 副作用 / Effects: `this.abort.signal.throwIfAborted`; `agent.destroy`; `this.abort.signal.addEventListener`; 更新 / updates `socket`.
   * 拒绝 / Refusals: 条件 / conditions `options.agent || options.createConnection || (options as http.RequestOptions).socketPath`; `!['ws:', 'wss:', 'http:', 'https:'].includes(protocol)`; 异常 / errors `new Error('Custom WebSocket transports are not supported')`; `new Error('Unsupported WebSocket protocol')`.
   * 失败处理：catch 分支执行 `agent.destroy();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `agent.destroy();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  webSocket = (url: string, options: WebSocket.ClientOptions = {}) => {
    this.abort.signal.throwIfAborted();
    this.runtime.check(this.identity, 'dial');
    if (options.agent || options.createConnection || (options as http.RequestOptions).socketPath)
      throw new Error('Custom WebSocket transports are not supported');
    const protocol = new URL(url).protocol;
    if (!['ws:', 'wss:', 'http:', 'https:'].includes(protocol))
      throw new Error('Unsupported WebSocket protocol');
    const agent = this.makeAgent(protocol === 'wss:' || protocol === 'https:', true);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, { ...options, agent });
    } catch (error) {
      agent.destroy();
      throw error;
    }
    /**
     * 入口 / Entry: NetworkScope.close.
     * 功能：把本层请求转交 `socket.terminate`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `socket.terminate` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `socket.terminate()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const close = () => socket.terminate();
    this.abort.signal.addEventListener('abort', close, { once: true });
    socket.once('close', () => {
      agent.destroy();
      this.abort.signal.removeEventListener('abort', close);
    });
    return socket;
  };
  /**
   * 入口 / Entry: NetworkScope.request.
   * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `request` 供上层消费（`NetworkScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; this entry produces `request` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
   * 处理：通过 `this.abort.signal.throwIfAborted`, `this.runtime.check`, `args.find`, `this.makeAgent` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.abort.signal.throwIfAborted`, `this.runtime.check`, `args.find`, `this.makeAgent`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: secure: boolean; args: any[]
   * 输出 / Returns: `request`.
   * 副作用 / Effects: `this.abort.signal.throwIfAborted`; `agent.destroy`; `request.once`; 更新 / updates `options.agent`, `options.signal`, `request`.
   * 拒绝 / Refusals: 条件 / conditions `options.createConnection || options.socketPath || options.socket || (options.agent && options.agent !== false)`; 异常 / errors `new Error('Use the managed network transport instead of a custom HTTP agent')`; `error`.
   * 失败处理：catch 分支执行 `agent.destroy();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `agent.destroy();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private request(secure: boolean, args: any[]) {
    this.abort.signal.throwIfAborted();
    this.runtime.check(this.identity, 'dial');
    const first = args[0];
    const urlForm = typeof first === 'string' || first instanceof URL;
    const options = { ...(urlForm ? (typeof args[1] === 'object' ? args[1] : {}) : first) };
    const callback = args.find((arg) => typeof arg === 'function');
    // SDK-specific agents/custom sockets cannot silently bypass network ownership.
    if (
      options.createConnection ||
      options.socketPath ||
      options.socket ||
      (options.agent && options.agent !== false)
    )
      throw new Error('Use the managed network transport instead of a custom HTTP agent');
    const agent = this.makeAgent(secure, true);
    options.agent = agent;
    options.signal = this.signal(options.signal);
    let request: http.ClientRequest;
    try {
      request = (secure ? https.request : http.request)(
        ...((urlForm ? [first, options, callback] : [options, callback]) as [any, any, any]),
      );
    } catch (error) {
      agent.destroy();
      throw error;
    }
    let detached = false;
    /**
     * 入口 / Entry: NetworkScope.request.detach.
     * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NetworkScope`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; the calls and state transitions below complete the operation. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
     * 处理：通过 `socket.once` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `socket.once`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: _response: http.IncomingMessage; socket: net.Socket
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `detached`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const detach = (_response: http.IncomingMessage, socket: net.Socket) => {
      detached = true;
      socket.once('close', () => agent.destroy());
    };
    request.once('connect', detach);
    request.once('upgrade', detach);
    request.once('close', () => {
      if (!detached) agent.destroy();
    });
    return request;
  }
  httpRequest: typeof http.request = ((...args: any[]) => this.request(false, args)) as typeof http.request;
  httpsRequest: typeof https.request = ((...args: any[]) => this.request(true, args)) as typeof https.request;
  httpsGet: typeof https.get = ((...args: any[]) => {
    const request = this.request(true, args);
    request.end();
    return request;
  }) as typeof https.get;
  /**
   * 入口 / Entry: NetworkScope.fetch.
   * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `globalThis.fetch(input, { ...init, signal, dispatcher: this.fetchAgent } as RequestInit)` 供上层消费（`NetworkScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; this entry produces `globalThis.fetch(input, { ...init, signal, dispatcher: this.fetchAgent } as RequestInit)` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
   * 处理：通过 `this.abort.signal.throwIfAborted`, `this.runtime.check`, `this.signal`, `globalThis.fetch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.abort.signal.throwIfAborted`, `this.runtime.check`, `this.signal`, `globalThis.fetch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input; init
   * 输出 / Returns: `globalThis.fetch(input, { ...init, signal, dispatcher: this.fetchAgent } as RequestInit)`.
   * 副作用 / Effects: `this.abort.signal.throwIfAborted`; `globalThis.fetch`; 更新 / updates `this.fetchAgent`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  fetch: typeof globalThis.fetch = (input, init) => {
    this.abort.signal.throwIfAborted();
    this.runtime.check(this.identity, 'dial');
    this.fetchAgent ||= new FetchAgent({
      connections: 16,
      pipelining: 1,
      keepAliveTimeout: 1000,
      /**
       * 入口 / Entry: NetworkScope.connect.
       * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NetworkScope`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; the calls and state transitions below complete the operation. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
       * 处理：通过 `options.hostname.replace`, `Promise.resolve().then().then`, `Promise.resolve().then`, `Promise.resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `options.hostname.replace`, `Promise.resolve().then().then`, `Promise.resolve().then`, `Promise.resolve`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: options; callback
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `options.hostname.replace`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      connect: (options, callback) => {
        const hostname = options.hostname.replace(/^\[|\]$/g, '');
        /**
         * 入口 / Entry: NetworkScope.callback@414.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then().then）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then().then).
         * 输入 / Inputs: socket
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `tls.connect`; `socket.destroy`; `setTimeout`; 更新 / updates `encrypted`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 失败处理：catch 分支执行 `socket.destroy();`; `callback(error as Error, null);`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `socket.destroy();`; `callback(error as Error, null);`; these statements determine whether a failure is absorbed or rejected again.
         */
        void Promise.resolve()
          .then(() =>
            this.dial({
              host: hostname,
              port: Number(options.port || (options.protocol === 'https:' ? 443 : 80)),
            }),
          )
          .then(
            (socket) => {
              if (options.protocol === 'https:') {
                let encrypted: tls.TLSSocket;
                try {
                  encrypted = tls.connect({
                    socket,
                    host: hostname,
                    ALPNProtocols: ['http/1.1'],
                    servername: options.servername || (net.isIP(hostname) ? undefined : hostname),
                  });
                } catch (error) {
                  socket.destroy();
                  callback(error as Error, null);
                  return;
                }
                let complete = false;
                /**
                 * 入口 / Entry: NetworkScope.finish.
                 * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`NetworkScope`）。
                 * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkScope`; this entry produces `void` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
                 * 处理：通过 `clearTimeout`, `encrypted.off`, `encrypted.destroy`, `callback` 协调依赖；下列分支决定是否继续、返回或拒绝。
                 * Processing: Coordinates its dependencies through `clearTimeout`, `encrypted.off`, `encrypted.destroy`, `callback`; the branches below determine continuation, return or refusal.
                 * 分支 / Branches: `complete`; `error`.
                 * 输入 / Inputs: error: Error optional
                 * 输出 / Returns: `void`.
                 * 副作用 / Effects: `clearTimeout`; `encrypted.destroy`; 更新 / updates `complete`.
                 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                 */
                const finish = (error?: Error) => {
                  if (complete) return;
                  complete = true;
                  clearTimeout(timer);
                  encrypted.off('error', failed);
                  encrypted.off('close', closed);
                  if (error) {
                    encrypted.destroy();
                    callback(error, null);
                  } else callback(null, encrypted);
                };
                /**
                 * 入口 / Entry: NetworkScope.failed.
                 * 功能：把本层请求转交 `finish`，沿用该实现的结果与失败路径。
                 * Purpose: Delegates this request to `finish` and propagates the provider result or rejection.
                 * 输入 / Inputs: error: Error
                 * 输出 / Returns: `finish(error)`.
                 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
                 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                 */
                const failed = (error: Error) => finish(error);
                /**
                 * 入口 / Entry: NetworkScope.closed.
                 * 功能：把本层请求转交 `finish`，沿用该实现的结果与失败路径。
                 * Purpose: Delegates this request to `finish` and propagates the provider result or rejection.
                 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
                 * 输出 / Returns: `finish(new Error('TLS connection closed before handshake completed'))`.
                 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
                 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                 */
                const closed = () => finish(new Error('TLS connection closed before handshake completed'));
                const timer = setTimeout(
                  () => finish(Object.assign(new Error('TLS handshake timed out'), { code: 'ETIMEDOUT' })),
                  10_000,
                );
                timer.unref();
                encrypted.once('secureConnect', () => finish());
                encrypted.once('error', failed);
                encrypted.once('close', closed);
              } else {
                callback(null, socket);
                socket.resume();
              }
            },
            (error) => callback(error, null),
          );
      },
    });
    const signal = this.signal(
      init && 'signal' in init
        ? init.signal || undefined
        : input instanceof Request
          ? input.signal
          : undefined,
    );
    return globalThis.fetch(input, { ...init, signal, dispatcher: this.fetchAgent } as RequestInit);
  };
  /**
   * 入口 / Entry: NetworkScope.close.
   * 功能：在提供按所有者划分的网络作用域中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closeTask` / `closing` 供上层消费（`NetworkScope`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `NetworkScope`; this entry produces `this.closeTask` / `closing` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
   * 处理：通过 `inline`, `closing.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline`, `closing.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closeTask`.
   * 输入 / Inputs: reason: unknown optional
   * 输出 / Returns: `this.closeTask`; `closing`.
   * 副作用 / Effects: 更新 / updates `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(reason?: unknown) {
    if (this.closeTask) return this.closeTask;
    /**
     * 入口 / Entry: NetworkScope.close.callback@471.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.abort.abort`; `agent.destroy`; `this.agents.clear`; `this.fetchAgent.destroy`; `this.release`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 收尾：退出 try 区域时始终执行 `await released;`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `await released;`; these steps also apply to exceptional exits.
     */
    const closing = (async () => {
      const released = this.runtime.whenReleased(this.identity);
      this.detachParent?.();
      this.abort.abort(reason);
      for (const agent of this.agents) agent.destroy();
      this.agents.clear();
      try {
        await this.fetchAgent?.destroy();
      } finally {
        await released;
      }
      this.release();
    })();
    this.closeTask = closing;
    void closing.catch(() => { if (this.closeTask === closing) this.closeTask = undefined; });
    return closing;
  }
}

/**
 * 入口 / Entry: networkFor.
 * 功能：从当前输入或状态计算 `new Proxy(Object.create(null), { get(_target, key) { if (key === 'close') return (reason?: unknown) => get(true)?.close(reaso…`，供调用方后续验证或使用。
 * Purpose: Computes `new Proxy(Object.create(null), { get(_target, key) { if (key === 'close') return (reason?: unknown) => get(true)?.close(reaso…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: owner: string; purpose: default=owner; signal: AbortSignal optional
 * 输出 / Returns: `new Proxy(Object.create(null), { get(_target, key) { if (key === 'close') return (reason?: unknown) => get(true)?.close(reaso…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function networkFor(owner: string, purpose = owner, signal?: AbortSignal) {
  const origin = pluginAuthority();
  const scopes = new WeakMap<PluginInstance, NetworkScope>();
  let core: NetworkScope | undefined;
  /**
   * 入口 / Entry: networkFor.get.
   * 功能：在提供按所有者划分的网络作用域中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `core ||= new NetworkScope({ owner, purpose }, networkRuntime, signal)` / `undefined` 供上层消费（`network/index.ts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `network/index.ts`; this entry produces `core ||= new NetworkScope({ owner, purpose }, networkRuntime, signal)` / `undefined` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
   * 处理：通过 `pluginAuthority`, `instance.check`, `scopes.get`, `withResourceContext` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pluginAuthority`, `instance.check`, `scopes.get`, `withResourceContext`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!instance`; `!closing`; `!scope`.
   * 输入 / Inputs: closing: default=false
   * 输出 / Returns: `core ||= new NetworkScope({ owner, purpose }, networkRuntime, signal)`; `undefined`; `scope`.
   * 副作用 / Effects: `scopes.set`; `instance.scope.add`; 更新 / updates `core`, `scope`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const get = (closing = false) => {
    const instance = origin || pluginAuthority();
    if (!instance) return core ||= new NetworkScope({ owner, purpose }, networkRuntime, signal);
    if (!closing) instance.check('network', true);
    let scope = scopes.get(instance);
    if (!scope) {
      if (closing) return undefined;
      scope = withResourceContext(instance.resourceIdentity, () => new NetworkScope({ owner: instance.owner, purpose }, networkRuntime,
        signal ? AbortSignal.any([signal, instance.signal]) : instance.signal));
      scopes.set(instance, scope);
      instance.scope.add(() => scope!.close());
    }
    return scope;
  };
  return new Proxy(Object.create(null), {
    /**
     * 入口 / Entry: networkFor.get.
     * 功能：在提供按所有者划分的网络作用域中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `(reason?: unknown) => get(true)?.close(reason) || Promise.resolve()` / `get()!.identity` 供上层消费（`network/index.ts`）。
     * Purpose: Reads/verifies domain state and constructs a caller-facing result in `network/index.ts`; this entry produces `(reason?: unknown) => get(true)?.close(reason) || Promise.resolve()` / `get()!.identity` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
     * 处理：通过 `get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `get`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `key === 'close'`; `key === 'identity'`.
     * 输入 / Inputs: _target; key
     * 输出 / Returns: `(reason?: unknown) => get(true)?.close(reason) || Promise.resolve()`; `get()!.identity`; `(...args: unknown[]) => { const scope = get()!; const instance = origin || pluginAuthority(); const invoke = () => Reflect.ap…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    get(_target, key) {
      if (key === 'close') return (reason?: unknown) => get(true)?.close(reason) || Promise.resolve();
      if (key === 'identity') return get()!.identity;
      /**
       * 入口 / Entry: networkFor.get.callback@512.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: args: unknown[]
       * 输出 / Returns: `instance ? withPluginAuthority(instance, invoke, () => instance.check('network', true)) : invoke()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return (...args: unknown[]) => {
        const scope = get()!;
        const instance = origin || pluginAuthority();
        /**
         * 入口 / Entry: networkFor.get.invoke.
         * 功能：在提供按所有者划分的网络作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Reflect.apply(Reflect.get(scope, key, scope), scope, instance ? args.map(arg => typeof arg === 'function' ? (...input: unknow…` 供上层消费（`network/index.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/index.ts`; this entry produces `Reflect.apply(Reflect.get(scope, key, scope), scope, instance ? args.map(arg => typeof arg === 'function' ? (...input: unknow…` for its caller. Module context: Provides owner-scoped requests, proxy environments and connection lifecycles over the shared network runtime.
         * 处理：通过 `Reflect.apply`, `Reflect.get`, `args.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `Reflect.apply`, `Reflect.get`, `args.map`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `Reflect.apply(Reflect.get(scope, key, scope), scope, instance ? args.map(arg => typeof arg === 'function' ? (...input: unknow…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const invoke = () => Reflect.apply(Reflect.get(scope, key, scope), scope, instance ? args.map(arg => typeof arg === 'function' ?
          (...input: unknown[]) => {
            if (instance.phase !== 'running' || instance.signal.aborted) return;
            try {
              return withPluginBackground(instance, () => { instance.check('network'); return Reflect.apply(arg, undefined, input); });
            } catch (error) { if (instance.signal.aborted || instance.phase !== 'running') return; throw error; }
          } : arg) : args);
        return instance ? withPluginAuthority(instance, invoke, () => instance.check('network', true)) : invoke();
      };
    },
    /**
     * 入口 / Entry: networkFor.set.
     * 功能：从当前输入或状态计算 `false`，供调用方后续验证或使用。
     * Purpose: Computes `false` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `false`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    set: () => false,
  }) as NetworkScope;
}
