/**
 * 模块职责：连接虚拟机网络后端并分配端口，将客户机网络资源纳入统一租约关闭流程。
 * Module purpose: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
 */
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { HostNetworkPool } from './host-pool.ts';
import { ROOT } from '../paths.ts';

export type VmNetworkOptions = {
  vmId: string;
  generation: string;
  isolated: boolean;
  ipv6?: boolean;
  sshPort: number;
  forwards: { host: number; guest: number }[];
  managementPorts?: { qmp: number; serial: number; agent: number };
  /**
   * 签名 / Signature: VmNetworkOptions.onFailure.
   * 功能：为连接虚拟机网络后端并分配端口声明 onFailure 的输入与结果契约，所属容器为 VmNetworkOptions。
   * Purpose: Declares the input/result contract for onFailure in VmNetworkOptions. Module responsibility: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
   * 输入 / Inputs: error: Error
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  onFailure(error: Error): void;
};
export type VmNetworkLease = {
  setIsolation?(isolated: boolean, expiresAt?: number): Promise<{ isolated: boolean | null; expiresAt: number | null; observedAt: string }>;
  observeIsolation?(): Promise<{ isolated: boolean | null; expiresAt: number | null; observedAt: string }>;
  readonly vmId: string;
  readonly generation: string;
  readonly netdev: string;
  readonly policy: Readonly<{
    isolated: boolean;
    ipv6: boolean;
    forwards: readonly { host: number; guest: number }[];
  }>;
  readonly signal: AbortSignal;
  readonly connected: boolean;
  readonly resources?: Readonly<{ worker: string; backend?: string }>;
  /**
   * 签名 / Signature: VmNetworkLease.setConnected.
   * 功能：为连接虚拟机网络后端并分配端口声明 setConnected 的输入与结果契约，所属容器为 VmNetworkLease。
   * Purpose: Declares the input/result contract for setConnected in VmNetworkLease. Module responsibility: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
   * 输入 / Inputs: connected: boolean
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  setConnected(connected: boolean): Promise<void>;
  /**
   * 签名 / Signature: VmNetworkLease.forward.
   * 功能：为连接虚拟机网络后端并分配端口声明 forward 的输入与结果契约，所属容器为 VmNetworkLease。
   * Purpose: Declares the input/result contract for forward in VmNetworkLease. Module responsibility: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
   * 输入 / Inputs: verb: 'add' | 'remove'; port: { host: number; guest: number }
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  forward(verb: 'add' | 'remove', port: { host: number; guest: number }): Promise<void>;
  /**
   * 签名 / Signature: VmNetworkLease.renew.
   * 功能：为连接虚拟机网络后端并分配端口声明 renew 的输入与结果契约，所属容器为 VmNetworkLease。
   * Purpose: Declares the input/result contract for renew in VmNetworkLease. Module responsibility: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
   * 输入 / Inputs: generation: string
   * 输出 / Returns: Promise<VmNetworkLease>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  renew(generation: string): Promise<VmNetworkLease>;
  /**
   * 签名 / Signature: VmNetworkLease.close.
   * 功能：为连接虚拟机网络后端并分配端口声明 close 的输入与结果契约，所属容器为 VmNetworkLease。
   * Purpose: Declares the input/result contract for close in VmNetworkLease. Module responsibility: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close(): Promise<void>;
};
// QEMU binds after this probe and validates the actual bind itself. A competing bind
// is a startup failure, never permission to choose an unmanaged network backend.
/**
 * 入口 / Entry: availablePort.
 * 功能：从当前输入或状态计算 `new Promise<number>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = (…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise<number>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = (…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new Promise<number>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = (…`.
 * 副作用 / Effects: `createServer`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function availablePort() {
  const server = createServer();
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** QEMU is used as a CPU-less libslirp host, with a separate hub for each VM. */
export class VmNetworkBackend {
  private leases = new Map<string, VmNetworkLease>();
  private nextHub = 0;
  private closed = false;
  /**
   * 入口 / Entry: VmNetworkBackend.constructor.
   * 功能：建立 VmNetworkBackend 的连接虚拟机网络后端并分配端口上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the VmNetworkBackend context for this module's responsibility: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: pool: HostNetworkPool
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(readonly pool: HostNetworkPool) {}
  /**
   * 入口 / Entry: VmNetworkBackend.attach.
   * 功能：为实例分配后端、端口与网络租约，连接网络失败观察和原运行取消。
   * Purpose: Allocates VM backends/ports/network leases with failure observation and original-run cancellation.
   * 设计：同一实例不能重复附加，端口配置在固定工作进程中串行；部分准备失败只收回本次申请资源。
   * Design: Duplicate attachment is refused, port changes serialize on the pinned worker and partial failure closes only this attempt's resources.
   * 输入 / Inputs: options: VmNetworkOptions
   * 输出 / Returns: Promise<VmNetworkLease>；结果来自 / values from `await serial(async () => { const port = await availablePort(); for (const config of [ userConfig(), { type: 'stream', id: id …`.
   * 副作用 / Effects: `randomUUID().replaceAll`; `this.leases.set`; `lease.close().catch`; `lease.close`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.leases.has(options.vmId)`; 异常 / errors `new Error('VM network backend is closed')`; `new Error('VM already has a network attachment')`.
   * 失败处理：catch 分支执行 `await lease.close().catch(() => {});`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await lease.close().catch(() => {});`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async attach(options: VmNetworkOptions): Promise<VmNetworkLease> {
    if (this.closed) throw new Error('VM network backend is closed');
    if (this.leases.has(options.vmId)) throw new Error('VM already has a network attachment');
    let abort = new AbortController();
    let workerFailed = false;
    const pin = this.pool.pin((error) => {
      workerFailed = true;
      abort.abort(error);
      options.onFailure(error);
    });
    const id = 'n' + randomUUID().replaceAll('-', '');
    const hubid = ++this.nextHub;
    const binary = join(
      process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu'),
      `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`,
    );
    /**
     * 入口 / Entry: VmNetworkBackend.attach.command.
     * 功能：把本层请求转交 `pin.call`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `pin.call` and propagates the provider result or rejection.
     * 输入 / Inputs: execute: string; args: Record<string, unknown>
     * 输出 / Returns: `pin.call('qmp', { binary, execute, args })`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const command = (execute: string, args: Record<string, unknown>) =>
      pin.call('qmp', { binary, execute, args });
    const added = new Set<string>();
    let bounded = false;
    let isolated = options.isolated;
    let forwards = [{ host: options.sshPort, guest: 22 }, ...options.forwards].map((p) => ({ ...p }));
    let netdev = '';
    /**
     * 入口 / Entry: VmNetworkBackend.attach.userConfig.
     * 功能：从当前输入或状态计算 `({ type: 'user', id: id + 'u', ipv4: true, ipv6: !options.isolated && options.ipv6 !== false, net: '10.0.2.0/24', host: '10.0…`，供调用方后续验证或使用。
     * Purpose: Computes `({ type: 'user', id: id + 'u', ipv4: true, ipv6: !options.isolated && options.ipv6 !== false, net: '10.0.2.0/24', host: '10.0…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `({ type: 'user', id: id + 'u', ipv4: true, ipv6: !options.isolated && options.ipv6 !== false, net: '10.0.2.0/24', host: '10.0…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const userConfig = () => ({
      type: 'user',
      id: id + 'u',
      ipv4: true,
      ipv6: !isolated && !bounded && options.ipv6 !== false,
      net: '10.0.2.0/24',
      host: '10.0.2.2',
      dns: '10.0.2.3',
      restrict: isolated,
      hostfwd: forwards.map((p) => ({ str: `tcp:127.0.0.1:${p.host}-:${p.guest}` })),
    });
    /**
     * 入口 / Entry: VmNetworkBackend.attach.add.
     * 功能：在连接虚拟机网络后端并分配端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`VmNetworkBackend`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `VmNetworkBackend`; the calls and state transitions below complete the operation. Module context: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
     * 处理：通过 `command`, `added.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `command`, `added.add`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: config: Record<string, unknown> & { id: string }
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `added.add`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const add = async (config: Record<string, unknown> & { id: string }) => {
      await command('netdev_add', config);
      added.add(config.id);
    };
    /**
     * 入口 / Entry: VmNetworkBackend.attach.remove.
     * 功能：在连接虚拟机网络后端并分配端口中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`VmNetworkBackend`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `VmNetworkBackend`; the calls and state transitions below complete the operation. Module context: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
     * 处理：通过 `command`, `added.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `command`, `added.delete`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: name: string
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `added.delete`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const remove = async (name: string) => {
      await command('netdev_del', { id: name });
      added.delete(name);
    };
    let tail: Promise<unknown> = Promise.resolve();
    /**
     * 入口 / Entry: VmNetworkBackend.attach.serial.
     * 功能：在连接虚拟机网络后端并分配端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`VmNetworkBackend`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `VmNetworkBackend`; this entry produces `result` for its caller. Module context: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
     * 处理：通过 `tail.then`, `result.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `tail.then`, `result.catch`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: work: () => Promise<T>
     * 输出 / Returns: Promise<T>；结果来自 / values from `result`.
     * 副作用 / Effects: 更新 / updates `tail`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const serial = <T>(work:
    /**
     * 中文功能：将 VmNetworkBackend.attach.serial.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
     * English: Supplies work to the original context owned by VmNetworkBackend.attach.serial.work, returning the declared business result or asynchronous rejection.
     * 所属 / Owner: VmNetworkBackend.attach.serial.work.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `Promise<T>`.
     */
    () => Promise<T>): Promise<T> => {
      const result = tail.then(work);
      tail = result.catch(() => {});
      return result;
    };
    /**
     * 入口 / Entry: VmNetworkBackend.attach.makeLease.
     * 功能：包装实例网络转发、连接和关闭能力，并记录当前网络代次。
     * Purpose: Wraps VM forwarding/dial/close capabilities and records the current network generation.
     * 设计：动态端口变更串行且核验回执，关闭撤销该代次并等待原物理资源；旧租约不能作用于新后端。
     * Design: Dynamic ports serialize/verify receipts; close revokes the generation and waits for physical resources so stale leases cannot touch replacements.
     * 输入 / Inputs: generation: string
     * 输出 / Returns: VmNetworkLease；结果来自 / values from `lease`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    const makeLease = (generation: string): VmNetworkLease => {
      const epoch = abort;
      let closeTask: Promise<void> | undefined;
      /**
       * 入口 / Entry: VmNetworkBackend.attach.callback@160.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（serial）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (serial).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `next`.
       * 副作用 / Effects: `epoch.abort`; `add`; `abort.signal.throwIfAborted`; `this.leases.set`; `abort.abort`; 更新 / updates `abort`.
       * 拒绝 / Refusals: 条件 / conditions `!generation || generation === lease.generation`; 异常 / errors `new Error('A new VM generation is required')`; `error`.
       * 失败处理：catch 分支执行 `const error = new Error('VM network generation renewal failed', { cause });`; `abort.abort(error);`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `const error = new Error('VM network generation renewal failed', { cause });`; `abort.abort(error);`; these statements determine whether a failure is absorbed or rejected again.
       */
      /**
       * 入口 / Entry: VmNetworkBackend.attach.callback@140.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（serial）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (serial).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 更新 / updates `forwards`.
       * 拒绝 / Refusals: 条件 / conditions `![port.host, port.guest].every( (value) => Number.isInteger(value) && value > 0 && value <= 65535, )`; `typeof result === 'string' && /could not|error|invalid|not found/i.test(result)`; 异常 / errors `new Error('Invalid forwarding port')`; `new Error(result.trim())`.
       */
      /**
       * 入口 / Entry: VmNetworkBackend.attach.callback@119.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（serial）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (serial).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `added.has`; `add`; `abort.abort`.
       * 拒绝 / Refusals: 异常 / errors `error`.
       * 失败处理：catch 分支执行 `const error = new Error('VM network link transition failed', { cause });`; `abort.abort(error);`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `const error = new Error('VM network link transition failed', { cause });`; `abort.abort(error);`; these statements determine whether a failure is absorbed or rejected again.
       */
      const lease: VmNetworkLease = {
        setIsolation: (value, expiresAt) => serial(async () => {
          epoch.signal.throwIfAborted();
          if (!options.isolated) throw new Error('Bounded egress requires an isolated VM baseline');
          bounded = true;
          const state = await pin.call('qmp-policy', { binary, config: userConfig(),
            hub: { type: 'hubport', id: id + 'hu', hubid, netdev: id + 'u' }, isolated: value, expiresAt });
          if (!state || typeof state.isolated !== 'boolean') throw new Error('Unknown network policy state');
          isolated = state.isolated;
          return state;
        }),
        observeIsolation: () => serial(async () => {
          epoch.signal.throwIfAborted();
          if (!bounded) return { isolated, expiresAt: null, observedAt: new Date().toISOString() };
          const state = await pin.call('qmp-policy-observe', { binary, id: id + 'u' });
          if (!state || typeof state.isolated !== 'boolean') throw new Error('Unknown network policy state');
          isolated = state.isolated;
          return state;
        }),
        vmId: options.vmId,
        generation,
        /**
         * 入口 / Entry: VmNetworkBackend.attach.resources.
         * 功能：把本层请求转交 `pin.resources`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `pin.resources` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `pin.resources()`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        get resources() {
          return pin.resources();
        },
        /**
         * 入口 / Entry: VmNetworkBackend.attach.netdev.
         * 功能：向调用者提供 `netdev` 的当前视图，不复制独立的业务状态。
         * Purpose: Exposes the current `netdev` view rather than creating separate domain state.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `netdev`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        get netdev() {
          return netdev;
        },
        signal: epoch.signal,
        /**
         * 入口 / Entry: VmNetworkBackend.attach.connected.
         * 功能：从当前输入或状态计算 `added.has(id + 'hs')`，供调用方后续验证或使用。
         * Purpose: Computes `added.has(id + 'hs')` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `added.has(id + 'hs')`.
         * 副作用 / Effects: `added.has`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        get connected() {
          return added.has(id + 'hs');
        },
        /**
         * 入口 / Entry: VmNetworkBackend.attach.setConnected.
         * 功能：把本层请求转交 `serial`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `serial` and propagates the provider result or rejection.
         * 输入 / Inputs: connected
         * 输出 / Returns: `serial(async () => { epoch.signal.throwIfAborted(); if (connected === added.has(id + 'hs')) return; try { if (connected) awai…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        setConnected: (connected) =>
          serial(
          /**
           * 中文功能：按原租约 epoch 增删 hubport 切换链路，相同状态不重复操作；失败取消该 epoch 并通知调用方。
           * English: Adds/removes the hubport under the lease epoch to change connectivity, avoiding duplicate states and aborting/reporting failure.
           * 所属 / Owner: VmNetworkBackend.attach.makeLease.lease.setConnected.
           * 输入 / Inputs: 无显式参数 / no explicit parameters.
           */
          async () => {
            epoch.signal.throwIfAborted();
            if (connected === added.has(id + 'hs')) return;
            try {
              if (connected) await add({ type: 'hubport', id: id + 'hs', hubid, netdev: id + 's' });
              else await remove(id + 'hs');
            } catch (cause) {
              const error = new Error('VM network link transition failed', { cause });
              abort.abort(error);
              options.onFailure(error);
              throw error;
            }
          }),
        /**
         * 入口 / Entry: VmNetworkBackend.attach.policy.
         * 功能：把本层请求转交 `forwards.map`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `forwards.map` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `Object.freeze({ isolated: options.isolated, ipv6: !options.isolated && options.ipv6 !== false, forwards: Object.freeze(forwar…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        get policy() {
          return Object.freeze({
            isolated,
            ipv6: !isolated && !bounded && options.ipv6 !== false,
            forwards: Object.freeze(forwards.map((p) => Object.freeze({ ...p }))),
          });
        },
        /**
         * 入口 / Entry: VmNetworkBackend.attach.forward.
         * 功能：把本层请求转交 `serial`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `serial` and propagates the provider result or rejection.
         * 输入 / Inputs: verb; port
         * 输出 / Returns: `serial(async () => { epoch.signal.throwIfAborted(); if ( ![port.host, port.guest].every( (value) => Number.isInteger(value) &…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        forward: (verb, port) =>
          serial(
          /**
           * 中文功能：校验 1..65535 端口并提交 QEMU hostfwd 增删，拒绝 monitor 错误后才更新租约列表。
           * English: Validates ports in 1..65535 and applies QEMU hostfwd changes, updating the lease list only after rejecting monitor errors.
           * 所属 / Owner: VmNetworkBackend.attach.makeLease.lease.forward.
           * 输入 / Inputs: 无显式参数 / no explicit parameters.
           */
          async () => {
            epoch.signal.throwIfAborted();
            if (
              ![port.host, port.guest].every(
                (value) => Number.isInteger(value) && value > 0 && value <= 65535,
              )
            )
              throw new Error('Invalid forwarding port');
            if (bounded && !isolated) throw new Error('Revoke bounded egress before changing forwards');
            const result = await command('human-monitor-command', {
              'command-line':
                verb === 'add'
                  ? `hostfwd_add ${id}u tcp:127.0.0.1:${port.host}-:${port.guest}`
                  : `hostfwd_remove ${id}u tcp:127.0.0.1:${port.host}`,
            });
            if (typeof result === 'string' && /could not|error|invalid|not found/i.test(result))
              throw new Error(result.trim());
            forwards =
              verb === 'add' ? [...forwards, { ...port }] : forwards.filter((p) => p.host !== port.host);
          }),
        /**
         * 入口 / Entry: VmNetworkBackend.attach.renew.
         * 功能：把本层请求转交 `serial`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `serial` and propagates the provider result or rejection.
         * 输入 / Inputs: generation
         * 输出 / Returns: `serial(async () => { epoch.signal.throwIfAborted(); if (!generation || generation === lease.generation) throw new Error('A ne…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        renew: (generation) =>
          serial(
          /**
           * 中文功能：要求新世代、取消旧 epoch，保留流/hub attachment 并重建用户网络清除旧流，再发布新租约。
           * English: Requires a new generation, cancels the old epoch, preserves stream/hub attachment while rebuilding user networking to clear old flows and publishes a new lease.
           * 所属 / Owner: VmNetworkBackend.attach.makeLease.lease.renew.
           * 输入 / Inputs: 无显式参数 / no explicit parameters.
           */
          async () => {
            epoch.signal.throwIfAborted();
            if (!generation || generation === lease.generation)
              throw new Error('A new VM generation is required');
            epoch.abort(new Error('VM network generation replaced'));
            abort = new AbortController();
            try {
              // Keep the stream and its current hub attachment state, but discard old flows.
              if (bounded) await pin.call('qmp-policy-forget', { binary, id: id + 'u' });
              isolated = options.isolated;
              bounded = false;
              await remove(id + 'hu');
              await remove(id + 'u');
              await add(userConfig());
              await add({ type: 'hubport', id: id + 'hu', hubid, netdev: id + 'u' });
              abort.signal.throwIfAborted();
              const next = makeLease(generation);
              this.leases.set(options.vmId, next);
              return next;
            } catch (cause) {
              const error = new Error('VM network generation renewal failed', { cause });
              abort.abort(error);
              options.onFailure(error);
              throw error;
            }
          }),
        /**
         * 入口 / Entry: VmNetworkBackend.attach.close.
         * 功能：在连接虚拟机网络后端并分配端口中，结束、撤销或清理本次拥有的领域资源；本入口产生 `Promise.resolve()` / `(closeTask ||= serial(async () => { // A renewal may have completed while this close waited in the queue. if (this.leases.get…` 供上层消费（`VmNetworkBackend`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `VmNetworkBackend`; this entry produces `Promise.resolve()` / `(closeTask ||= serial(async () => { // A renewal may have completed while this close waited in the queue. if (this.leases.get…` for its caller. Module context: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
         * 处理：通过 `this.leases.get`, `Promise.resolve`, `serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.leases.get`, `Promise.resolve`, `serial`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `this.leases.get(options.vmId) !== lease`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `Promise.resolve()`; `(closeTask ||= serial(async () => { // A renewal may have completed while this close waited in the queue. if (this.leases.get…`.
         * 副作用 / Effects: 更新 / updates `closeTask`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        close: () => {
          // Releasing a stale capability cannot tear down the newer generation.
          if (this.leases.get(options.vmId) !== lease) return Promise.resolve();
          /**
           * 入口 / Entry: VmNetworkBackend.attach.callback@186.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（serial）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (serial).
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: `void`.
           * 副作用 / Effects: `epoch.abort`; `this.leases.delete`; `pin.release`.
           * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `new AggregateError(errors, 'VM network cleanup failed')`.
           */
          return (closeTask ||= serial(async () => {
            // A renewal may have completed while this close waited in the queue.
            if (this.leases.get(options.vmId) !== lease) return;
            epoch.abort(new Error('VM network lease released'));
            this.leases.delete(options.vmId);
            const errors: unknown[] = [];
            if (bounded && !workerFailed) await pin.call('qmp-policy-forget', { binary, id: id + 'u' }).catch(error => errors.push(error));
            if (!workerFailed)
              for (const name of [...added].reverse())
                await remove(name).catch((error) => errors.push(error));
            pin.release();
            if (errors.length) {
              await pin.terminate();
              throw new AggregateError(errors, 'VM network cleanup failed');
            }
          }));
        },
      };
      return lease;
    };
    const lease = makeLease(options.generation);
    this.leases.set(options.vmId, lease);
    try {
      /**
       * 入口 / Entry: VmNetworkBackend.attach.callback@208.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（serial）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (serial).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `lease`.
       * 副作用 / Effects: `add`; `abort.signal.throwIfAborted`; 更新 / updates `netdev`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return await serial(async () => {
        const port = await availablePort();
        for (const config of [
          userConfig(),
          {
            type: 'stream',
            id: id + 's',
            server: true,
            addr: { type: 'inet', host: '127.0.0.1', port: String(port) },
          },
          { type: 'hubport', id: id + 'hu', hubid, netdev: id + 'u' },
          { type: 'hubport', id: id + 'hs', hubid, netdev: id + 's' },
        ]) {
          await add(config);
        }
        netdev = `stream,id=sakura-net,server=off,addr.type=inet,addr.host=127.0.0.1,addr.port=${port}`;
        abort.signal.throwIfAborted();
        return lease;
      });
    } catch (error) {
      await lease.close().catch(() => {});
      throw error;
    }
  }
  /**
   * 入口 / Entry: VmNetworkBackend.snapshot.
   * 功能：在连接虚拟机网络后端并分配端口中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `[...this.leases.values()].map(({ vmId, generation, policy, connected, resources }) => ({ vmId, generation, policy, connected,…` 供上层消费（`VmNetworkBackend`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `VmNetworkBackend`; this entry produces `[...this.leases.values()].map(({ vmId, generation, policy, connected, resources }) => ({ vmId, generation, policy, connected,…` for its caller. Module context: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
   * 处理：通过 `inline.map`, `this.leases.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.map`, `this.leases.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `[...this.leases.values()].map(({ vmId, generation, policy, connected, resources }) => ({ vmId, generation, policy, connected,…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  snapshot() {
    return [...this.leases.values()].map(({ vmId, generation, policy, connected, resources }) => ({
      vmId,
      generation,
      policy,
      connected,
      resources,
    }));
  }
  /**
   * 入口 / Entry: VmNetworkBackend.close.
   * 功能：在连接虚拟机网络后端并分配端口中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`VmNetworkBackend`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `VmNetworkBackend`; the outcome is recorded in `this.closed`. Module context: Connects VM network backends and allocates ports, placing guest network resources under lease shutdown.
   * 处理：通过 `Promise.allSettled`, `inline.map`, `this.leases.values`, `this.pool.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.allSettled`, `inline.map`, `this.leases.values`, `this.pool.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.pool.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.leases.values()].map((lease) => lease.close()));
    await this.pool.close();
  }
}
