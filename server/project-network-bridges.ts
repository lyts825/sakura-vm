/**
 * 模块职责：为私有项目网络建立本机桥接，管理端口、连接和原桥接资源的停止。
 * Module purpose: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
 */
import { networkFor } from './network/index.ts';
import { randomUUID } from 'node:crypto';
import { type Server, type Socket } from 'node:net';
import type { ClientChannel } from 'ssh2';
import type { VmAccess as Machines } from './vm-access.ts';
import type { Project } from './project-config.ts';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
import { projectNetworkCommand, projectNetworkNamespace } from './project-network-isolation.ts';

const { createServer } = networkFor('core:project-network-bridges');

type Bridge = {
  vmId: string;
  namespace: string;
  guestPort: number;
  hostPort: number;
  command: string;
  project: Project;
  server: Server;
  abort: AbortController;
  sockets: Set<Socket>;
  opening: Promise<void>;
  disposing?: Promise<void>;
};

// This relay only connects to one fixed loopback port inside the project
// namespace. It transports HTTP and WebSocket bytes without adding a guest
// interface, route, proxy or destination chosen by the browser.
/**
 * 入口 / Entry: relayCommand.
 * 功能：在为私有项目网络建立本机桥接中，执行此领域的具体处理步骤并返回其结果；本入口产生 `projectNetworkCommand(project, `exec python3 -I -S -u -c ${quote(script)}`)` 供上层消费（`project-network-bridges.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-network-bridges.ts`; this entry produces `projectNetworkCommand(project, `exec python3 -I -S -u -c ${quote(script)}`)` for its caller. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
 * 处理：通过 `inline.join`, `projectNetworkCommand`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.join`, `projectNetworkCommand`, `quote`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; port: number
 * 输出 / Returns: `projectNetworkCommand(project, `exec python3 -I -S -u -c ${quote(script)}`)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function relayCommand(project: Project, port: number) {
  const script = [
    'import socket,sys,threading',
    `sock=socket.create_connection(("127.0.0.1",${port}),10)`,
    'sock.settimeout(None)',
    'def upstream():',
    '  try:',
    '    while True:',
    '      data=sys.stdin.buffer.read1(65536)',
    '      if not data: break',
    '      sock.sendall(data)',
    '  except OSError: pass',
    '  finally:',
    '    try: sock.shutdown(socket.SHUT_WR)',
    '    except OSError: pass',
    'threading.Thread(target=upstream,daemon=True).start()',
    'try:',
    '  while True:',
    '    data=sock.recv(65536)',
    '    if not data: break',
    '    sys.stdout.buffer.write(data)',
    '    sys.stdout.buffer.flush()',
    'finally: sock.close()',
  ].join('\n');
  return projectNetworkCommand(project, `exec python3 -I -S -u -c ${quote(script)}`);
}

export class ProjectNetworkBridges {
  private readonly owner = 'project-network-bridge:' + randomUUID();
  private bridges = new Map<string, Bridge>();
  private stopping = new Map<string, Promise<void>>();
  private closed = false;
  /**
   * 入口 / Entry: ProjectNetworkBridges.isRunning.
   * 功能：在为私有项目网络建立本机桥接中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.state(id) === 'running'` / `false` 供上层消费（`ProjectNetworkBridges`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectNetworkBridges`; this entry produces `this.machines.state(id) === 'running'` / `false` for its caller. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
   * 处理：通过 `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.machines.state(id) === 'running'`; `false`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private isRunning(id: string) {
    try { return this.machines.state(id) === 'running'; }
    catch { return false; }
  }
  /**
   * 入口 / Entry: ProjectNetworkBridges.changed.
   * 功能：在为私有项目网络建立本机桥接中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectNetworkBridges`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectNetworkBridges`; the calls and state transitions below complete the operation. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
   * 处理：通过 `this.isRunning`, `this.stopKey` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.isRunning`, `this.stopKey`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.isRunning(bridge.vmId)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stopKey`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private readonly changed = () => {
    for (const [key, bridge] of this.bridges)
      if (!this.isRunning(bridge.vmId)) void this.stopKey(key);
  };
  /**
   * 入口 / Entry: ProjectNetworkBridges.locked.
   * 功能：在为私有项目网络建立本机桥接中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectNetworkBridges`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectNetworkBridges`; the calls and state transitions below complete the operation. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
   * 处理：通过 `this.stopKey` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stopKey`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `bridge.vmId === id`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stopKey`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private readonly locked = (id: string) => {
    for (const [key, bridge] of this.bridges)
      if (bridge.vmId === id) void this.stopKey(key);
  };

  /**
   * 入口 / Entry: ProjectNetworkBridges.constructor.
   * 功能：建立 ProjectNetworkBridges 的为私有项目网络建立本机桥接上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectNetworkBridges context for this module's responsibility: Creates local bridges for private project networks, owning their ports, connections and original shutdown. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; validate: (id: string, project: Project, signal?: AbortSignal) => Promise<void> optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines,
    private validate?: (id: string, project: Project, signal?: AbortSignal) => Promise<void>) {
    machines.on('change', this.changed);
    machines.on('incident-lockdown', this.locked);
  }

  /**
   * 入口 / Entry: ProjectNetworkBridges.open.
   * 功能：在为私有项目网络建立本机桥接中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ProjectNetworkBridges`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectNetworkBridges`; this entry produces `void` for its caller. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
   * 处理：通过 `projectNetworkNamespace`, `inline.every`, `signal.throwIfAborted`, `this.isRunning` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectNetworkNamespace`, `inline.every`, `signal.throwIfAborted`, `this.isRunning`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; project: Project; guestPort: number; hostPort: number; signal: AbortSignal optional; allowShared: default=false
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.stopping.get`; `createServer`; `this.bridges.set`; `signal.addEventListener`; 更新 / updates `bridge.opening`.
   * 拒绝 / Refusals: 条件 / conditions `!namespace && !allowShared`; `![guestPort, hostPort].every((port) => Number.isInteger(port) && port >= 1024 && port <= 65535)`; `this.closed`; 异常 / errors `new AppError('本机桥接需要私有项目网络', 409)`; `new AppError('项目桥接端口无效')`.
   */
  async open(id: string, project: Project, guestPort: number, hostPort: number,
    signal?: AbortSignal, allowShared = false) {
    const namespace = projectNetworkNamespace(project);
    if (!namespace && !allowShared) throw new AppError('本机桥接需要私有项目网络', 409);
    if (![guestPort, hostPort].every((port) => Number.isInteger(port) && port >= 1024 && port <= 65535))
      throw new AppError('项目桥接端口无效');
    if (this.closed) throw new AppError('项目桥接服务已关闭', 409);
    signal?.throwIfAborted();
    if (!this.isRunning(id)) throw new AppError('请先启动实例', 409);
    this.machines.requireUnlocked(id);
    const scope = namespace || `host-${project._workspace || 'default'}`;
    const key = `${id}:${scope}`;
    await this.stopping.get(key);
    if (this.closed || !this.isRunning(id)) throw new AppError('实例或项目桥接已关闭', 409);
    const prior = this.bridges.get(key);
    if (prior) {
      if (prior.guestPort !== guestPort || prior.hostPort !== hostPort)
        throw new AppError('请先关闭已有项目桥接，再修改端口', 409);
      await prior.opening;
      signal?.throwIfAborted();
      await this.validate?.(id, project, signal);
      return;
    }
    const server = createServer({ allowHalfOpen: true },
      (socket) => void this.connect(key, server, socket));
    const bridge: Bridge = { vmId: id, namespace: scope, guestPort, hostPort, project,
      command: relayCommand(project, guestPort), server,
      abort: new AbortController(), sockets: new Set(), opening: Promise.resolve() };
    this.bridges.set(key, bridge);
    /**
     * 入口 / Entry: ProjectNetworkBridges.open.abort.
     * 功能：把本层请求转交 `bridge.abort.abort`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `bridge.abort.abort` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `bridge.abort.abort(signal?.reason)`.
     * 副作用 / Effects: `bridge.abort.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abort = () => bridge.abort.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    /**
     * 入口 / Entry: ProjectNetworkBridges.open.callback@115.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.machines.exec`; `bridge.abort.signal.throwIfAborted`; `this.bridges.delete`; `bridge.abort.abort`; 更新 / updates `reserved`.
     * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; `this.closed || !this.isRunning(id) || this.bridges.get(key) !== bridge`; 异常 / errors `new AppError(result.stderr || '项目命名空间或 Python 桥接未就绪', 409)`; `new AppError('实例或项目桥接已关闭', 409)`.
     * 收尾：退出 try 区域时始终执行 `signal?.removeEventListener('abort', abort);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `signal?.removeEventListener('abort', abort);`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `if (this.bridges.get(key) === bridge) this.bridges.delete(key);`; `if (reserved) await this.dispose(key, bridge); else bridge.abort.abort();`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (this.bridges.get(key) === bridge) this.bridges.delete(key);`; `if (reserved) await this.dispose(key, bridge); else bridge.abort.abort();`; these statements determine whether a failure is absorbed or rejected again.
     */
    bridge.opening = (async () => {
      let reserved = false;
      try {
        signal?.throwIfAborted();
        this.machines.requireUnlocked(id);
        await this.validate?.(id, project, bridge.abort.signal);
        this.machines.reserveHostPorts(this.owner + ':' + key, [hostPort]);
        reserved = true;
        const result = await this.machines.exec(id,
          projectNetworkCommand(project, 'python3 -I -S -c "import socket,threading"'),
          10000, bridge.abort.signal);
        if (result.code !== 0) throw new AppError(result.stderr || '项目命名空间或 Python 桥接未就绪', 409);
        bridge.abort.signal.throwIfAborted();
        if (this.closed || !this.isRunning(id) || this.bridges.get(key) !== bridge)
          throw new AppError('实例或项目桥接已关闭', 409);
        this.machines.requireUnlocked(id);
        /**
         * 入口 / Entry: ProjectNetworkBridges.open.callback@131.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
         * 输入 / Inputs: resolve; reject
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `server.listen`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        await new Promise<void>((resolve, reject) => {
          /**
           * 入口 / Entry: ProjectNetworkBridges.open.failed.
           * 功能：把本层请求转交 `reject`，沿用该实现的结果与失败路径。
           * Purpose: Delegates this request to `reject` and propagates the provider result or rejection.
           * 输入 / Inputs: error: Error
           * 输出 / Returns: `reject(error)`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const failed = (error: Error) => reject(error);
          server.once('error', failed);
          server.listen({ port: hostPort, host: '127.0.0.1', signal: bridge.abort.signal }, () => {
            server.off('error', failed);
            resolve();
          });
          // An aborted listen can emit close without emitting error.
          server.once('close', () => reject(new AppError('项目桥接已关闭', 409)));
        });
        server.on('error', () => void this.stopKey(key));
        bridge.abort.signal.throwIfAborted();
      } catch (error) {
        if (this.bridges.get(key) === bridge) this.bridges.delete(key);
        if (reserved) await this.dispose(key, bridge);
        else bridge.abort.abort();
        throw error;
      } finally { signal?.removeEventListener('abort', abort); }
    })();
    await bridge.opening;
  }

  /**
   * 入口 / Entry: ProjectNetworkBridges.connect.
   * 功能：在为私有项目网络建立本机桥接中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ProjectNetworkBridges`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectNetworkBridges`; this entry produces `void` for its caller. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
   * 处理：通过 `this.bridges.get`, `this.isRunning`, `socket.destroy`, `bridge.sockets.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.bridges.get`, `this.isRunning`, `socket.destroy`, `bridge.sockets.add`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!bridge || bridge.server !== server || bridge.abort.signal.aborted || bridge.sockets.size >= 32 || !…`; `abort.signal.aborted || this.bridges.get(key) !== bridge`; `socket.destroyed || this.bridges.get(key) !== bridge`.
   * 输入 / Inputs: key: string; server: Server; socket: Socket
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `socket.destroy`; `bridge.sockets.add`; `this.machines.connect`; `abort.signal.addEventListener`; `client.destroy`.
   * 拒绝 / Refusals: 条件 / conditions `!this.isRunning(bridge.vmId) || this.bridges.get(key) !== bridge || abort.signal.aborted`; 异常 / errors `new AppError('原项目桥接归属已改变', 409)`.
   * 失败处理：catch 分支执行 `socket.destroy();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `socket.destroy();`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async connect(key: string, server: Server, socket: Socket) {
    const bridge = this.bridges.get(key);
    if (!bridge || bridge.server !== server || bridge.abort.signal.aborted || bridge.sockets.size >= 32 ||
        !this.isRunning(bridge.vmId)) { socket.destroy(); return; }
    const abort = new AbortController();
    bridge.sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => {
      abort.abort();
      bridge.sockets.delete(socket);
    });
    try {
      this.machines.requireUnlocked(bridge.vmId);
      await this.validate?.(bridge.vmId, bridge.project, abort.signal);
      const client = await this.machines.connect(bridge.vmId, 10000, abort.signal);
      /**
       * 入口 / Entry: ProjectNetworkBridges.connect.destroy.
       * 功能：把本层请求转交 `client.destroy`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `client.destroy` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `client.destroy()`.
       * 副作用 / Effects: `client.destroy`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const destroy = () => client.destroy();
      abort.signal.addEventListener('abort', destroy, { once: true });
      client.once('close', () => socket.destroy());
      client.on('error', () => socket.destroy());
      if (abort.signal.aborted || this.bridges.get(key) !== bridge) {
        client.destroy(); socket.destroy(); return;
      }
      try {
        // Connection establishment may outlive the original live/boot proof.
        await this.validate?.(bridge.vmId, bridge.project, abort.signal);
        if (!this.isRunning(bridge.vmId) || this.bridges.get(key) !== bridge || abort.signal.aborted)
          throw new AppError('原项目桥接归属已改变', 409);
        /**
         * 入口 / Entry: ProjectNetworkBridges.connect.callback@180.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
         * 输入 / Inputs: resolve; reject
         * 输出 / Returns: `cancelled()`.
         * 副作用 / Effects: `setTimeout`; `abort.signal.addEventListener`; `client.exec`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const channel = await new Promise<ClientChannel>((resolve, reject) => {
          let settled = false;
          /**
           * 入口 / Entry: ProjectNetworkBridges.connect.finish.
           * 功能：在为私有项目网络建立本机桥接中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ProjectNetworkBridges`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectNetworkBridges`; this entry produces `void` for its caller. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
           * 处理：通过 `stream.destroy`, `clearTimeout`, `client.off`, `abort.signal.removeEventListener` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `stream.destroy`, `clearTimeout`, `client.off`, `abort.signal.removeEventListener`; the branches below determine continuation, return or refusal.
           * 分支 / Branches: `settled`.
           * 输入 / Inputs: error: Error optional; stream: ClientChannel optional
           * 输出 / Returns: `void`.
           * 副作用 / Effects: `stream.destroy`; `clearTimeout`; `abort.signal.removeEventListener`; 更新 / updates `settled`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const finish = (error?: Error, stream?: ClientChannel) => {
            if (settled) { stream?.destroy(); return; }
            settled = true;
            clearTimeout(timer);
            client.off('close', closed);
            abort.signal.removeEventListener('abort', cancelled);
            error ? reject(error) : resolve(stream!);
          };
          /**
           * 入口 / Entry: ProjectNetworkBridges.connect.closed.
           * 功能：把本层请求转交 `finish`，沿用该实现的结果与失败路径。
           * Purpose: Delegates this request to `finish` and propagates the provider result or rejection.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: `finish(new Error('SSH connection closed'))`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const closed = () => finish(new Error('SSH connection closed'));
          /**
           * 入口 / Entry: ProjectNetworkBridges.connect.cancelled.
           * 功能：把本层请求转交 `finish`，沿用该实现的结果与失败路径。
           * Purpose: Delegates this request to `finish` and propagates the provider result or rejection.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: `finish(new AppError('项目桥接连接已取消', 409))`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const cancelled = () => finish(new AppError('项目桥接连接已取消', 409));
          const timer = setTimeout(() => finish(new AppError('项目桥接连接超时', 504)), 10000);
          timer.unref();
          client.once('close', closed);
          abort.signal.addEventListener('abort', cancelled, { once: true });
          if (abort.signal.aborted) return cancelled();
          client.exec(bridge.command, (error, stream) => finish(error || undefined, stream));
        });
        if (socket.destroyed || this.bridges.get(key) !== bridge) { channel.destroy(); return; }
        channel.stderr.resume();
        channel.stderr.on('error', () => socket.destroy());
        channel.on('error', () => socket.destroy());
        // EOF ends the response, preserving buffered bytes; client close is
        // deferred until the local socket has flushed them.
        channel.once('end', () => socket.end());
        channel.once('close', () => socket.end());
        socket.pipe(channel).pipe(socket);
      } catch { socket.destroy(); }
      if (socket.destroyed) client.destroy();
    } catch { socket.destroy(); }
  }

  /**
   * 入口 / Entry: ProjectNetworkBridges.dispose.
   * 功能：在为私有项目网络建立本机桥接中，结束、撤销或清理本次拥有的领域资源；本入口产生 `bridge.disposing` 供上层消费（`ProjectNetworkBridges`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectNetworkBridges`; this entry produces `bridge.disposing` for its caller. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
   * 处理：通过 `socket.destroy`, `Promise.finally` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `socket.destroy`, `Promise.finally`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `bridge.disposing`.
   * 输入 / Inputs: key: string; bridge: Bridge
   * 输出 / Returns: `bridge.disposing`.
   * 副作用 / Effects: `socket.destroy`; 更新 / updates `bridge.disposing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private dispose(key: string, bridge: Bridge) {
    if (bridge.disposing) return bridge.disposing;
    for (const socket of bridge.sockets) socket.destroy();
    bridge.disposing = new Promise<void>((resolve) => {
      bridge.server.close(() => resolve());
      bridge.abort.abort();
    }).finally(() => this.machines.reserveHostPorts(this.owner + ':' + key, []));
    return bridge.disposing;
  }

  /**
   * 入口 / Entry: ProjectNetworkBridges.stopKey.
   * 功能：在为私有项目网络建立本机桥接中，结束、撤销或清理本次拥有的领域资源；本入口产生 `pending` / `Promise.resolve()` 供上层消费（`ProjectNetworkBridges`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectNetworkBridges`; this entry produces `pending` / `Promise.resolve()` for its caller. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
   * 处理：通过 `this.stopping.get`, `this.bridges.get`, `Promise.resolve`, `this.bridges.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stopping.get`, `this.bridges.get`, `Promise.resolve`, `this.bridges.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `pending`; `!bridge`.
   * 输入 / Inputs: key: string
   * 输出 / Returns: Promise<void>；结果来自 / values from `pending`; `Promise.resolve()`; `stopping`.
   * 副作用 / Effects: `this.stopping.get`; `this.bridges.delete`; `bridge.abort.abort`; `socket.destroy`; `this.stopping.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private stopKey(key: string): Promise<void> {
    const pending = this.stopping.get(key);
    if (pending) return pending;
    const bridge = this.bridges.get(key);
    if (!bridge) return Promise.resolve();
    this.bridges.delete(key);
    bridge.abort.abort();
    for (const socket of bridge.sockets) socket.destroy();
    const stopping = bridge.opening.catch(() => {}).then(() => this.dispose(key, bridge))
      .finally(() => this.stopping.delete(key));
    this.stopping.set(key, stopping);
    return stopping;
  }

  /**
   * 入口 / Entry: ProjectNetworkBridges.stop.
   * 功能：在为私有项目网络建立本机桥接中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectNetworkBridges`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectNetworkBridges`; the calls and state transitions below complete the operation. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
   * 处理：通过 `Promise.all`, `this.stopKey` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.all`, `this.stopKey`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stopKey`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async stop(id: string, projectId: string) {
    await Promise.all([this.stopKey(`${id}:sk-${projectId}`), this.stopKey(`${id}:host-${projectId}`)]);
  }

  /**
   * 入口 / Entry: ProjectNetworkBridges.close.
   * 功能：在为私有项目网络建立本机桥接中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`ProjectNetworkBridges`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectNetworkBridges`; the outcome is recorded in `this.closed`. Module context: Creates local bridges for private project networks, owning their ports, connections and original shutdown.
   * 处理：通过 `this.machines.off`, `Promise.all`, `inline.map`, `this.bridges.keys` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.off`, `Promise.all`, `inline.map`, `this.bridges.keys`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stopping.values`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.machines.off('change', this.changed);
    this.machines.off('incident-lockdown', this.locked);
    await Promise.all([...this.bridges.keys()].map((key) => this.stopKey(key)));
    await Promise.all(this.stopping.values());
  }
}
