/**
 * 模块职责：管理实例 SSH 连接、命令、输入和文件传输，操作受实例状态及原运行身份限制。
 * Module purpose: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, type BaseAgent, type ClientCallback, type ExecOptions, type SFTPWrapper } from 'ssh2';
import { AppError } from '../shared/errors.ts';
import type { Machines } from './machines.ts';
import { networkRuntime } from './network/index.ts';
import { vmDir } from './paths.ts';
import type { Project } from './project-config.ts';
import { projectNetworkCommand } from './project-network-isolation.ts';
import type { Live } from './vm-state.ts';

/** Stateless transport; the facade retains VM identities, locks and client ownership. */
export class MachineTransport {
  /**
   * 入口 / Entry: MachineTransport.constructor.
   * 功能：建立 MachineTransport 的管理实例 SSH 连接、命令、输入和文件传输上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the MachineTransport context for this module's responsibility: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: host: Pick<Machines, 'live' | 'requireUnlocked' | 'connect'> & { closing?: boolean }
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private host: Pick<Machines, 'live' | 'requireUnlocked' | 'connect'> & { closing?: boolean }) {}
  /**
   * 入口 / Entry: MachineTransport.connect.
   * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await this.connectOnce(live, key, Math.min(remaining, 5000), signal, agentPath)` / `this.connectOnce( live, Buffer.from(pending.privateText), Math.max(1, deadline - performance.now()), signal, agentPath, )` 供上层消费（`MachineTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `await this.connectOnce(live, key, Math.min(remaining, 5000), signal, agentPath)` / `this.connectOnce( live, Buffer.from(pending.privateText), Math.max(1, deadline - performance.now()), signal, agentPath, )` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
   * 处理：通过 `this.host.requireUnlocked`, `this.host.live.get`, `performance.now`, `readFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.host.requireUnlocked`, `this.host.live.get`, `performance.now`, `readFile`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; timeout: default=10000; signal: AbortSignal optional; agentPath: string | BaseAgent optional
   * 输出 / Returns: `await this.connectOnce(live, key, Math.min(remaining, 5000), signal, agentPath)`; `this.connectOnce( live, Buffer.from(pending.privateText), Math.max(1, deadline - performance.now()), signal, agentPath, )`.
   * 副作用 / Effects: `this.connectOnce`.
   * 拒绝 / Refusals: 条件 / conditions `!live || live.status === 'stopping' || live.status === 'paused'`; `this.host.live.get(id) !== live || this.host.live.get(id)?.status === 'stopping'`; `remaining <= 0`; 异常 / errors `new AppError(live?.status === 'paused' ? '发行版已暂停，请先恢复' : '请先启动该发行版', 409)`; `new AppError('发行版已停止', 409)`.
   * 失败处理：catch 分支执行 `if ( (error as Error).message.includes('authentication') && existsSync(join(vmDir(id), 'identity.json')) ) { const pending = …`; `const wait = 100 * 2 ** attempt;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ( (error as Error).message.includes('authentication') && existsSync(join(vmDir(id), 'identity.json')) ) { const pending = …`; `const wait = 100 * 2 ** attempt;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async connect(id: string, timeout = 10000, signal?: AbortSignal, agentPath?: string | BaseAgent) {
    this.host.requireUnlocked(id);
    const live = this.host.live.get(id);
    if (!live || live.status === 'stopping' || live.status === 'paused')
      throw new AppError(live?.status === 'paused' ? '发行版已暂停，请先恢复' : '请先启动该发行版', 409);
    const deadline = performance.now() + timeout;
    const key = await readFile(join(vmDir(id), 'id_rsa'));
    for (let attempt = 0; ; attempt++) {
      this.host.requireUnlocked(id);
      signal?.throwIfAborted();
      if (this.host.live.get(id) !== live || this.host.live.get(id)?.status === 'stopping')
        throw new AppError('发行版已停止', 409);
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error('SSH connection timed out');
      try {
        // Leave room for a fresh handshake when a restored guest drops the first
        // connection. No command has been submitted until connect() returns.
        return await this.connectOnce(live, key, Math.min(remaining, 5000), signal, agentPath);
      } catch (error) {
        // An interrupted clone rekey may have updated the guest before the host
        // key file. Recover using the pending key without replaying commands.
        if (
          (error as Error).message.includes('authentication') &&
          existsSync(join(vmDir(id), 'identity.json'))
        ) {
          const pending = JSON.parse(await readFile(join(vmDir(id), 'identity.json'), 'utf8'));
          signal?.throwIfAborted();
          if (this.host.live.get(id) !== live || this.host.live.get(id)?.status === 'stopping')
            throw new AppError('发行版已停止', 409);
          return this.connectOnce(
            live,
            Buffer.from(pending.privateText),
            Math.max(1, deadline - performance.now()),
            signal,
            agentPath,
          );
        }
        // QEMU/sshd can refuse or reset an admission during boot or RAM restore.
        // Retry only connection establishment, never commands or authentication
        // rejection, and keep every attempt inside the caller's deadline.
        const wait = 100 * 2 ** attempt;
        const transient = ['ECONNREFUSED', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code || '') ||
          ['Connection lost before handshake', 'SSH connection timed out', 'Timed out while waiting for handshake']
            .includes((error as Error).message);
        if (
          !transient ||
          attempt >= 3 ||
          deadline - performance.now() <= wait
        )
          throw error;
        await delay(wait, undefined, { signal });
      }
    }
  }
  /**
   * 入口 / Entry: MachineTransport.connectOnce.
   * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new Promise<Client>((resolve, reject) => { const client = new Client(); client.once('close', () => socket.destroy()); const a…` 供上层消费（`MachineTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `new Promise<Client>((resolve, reject) => { const client = new Client(); client.once('close', () => socket.destroy()); const a…` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
   * 处理：通过 `signal.throwIfAborted`, `performance.now`, `AbortSignal.any`, `networkRuntime.dial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `performance.now`, `AbortSignal.any`, `networkRuntime.dial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: live: Live; key: Buffer; timeout: number; signal: AbortSignal optional; agentPath: string | BaseAgent optional
   * 输出 / Returns: `new Promise<Client>((resolve, reject) => { const client = new Client(); client.once('close', () => socket.destroy()); const a…`.
   * 副作用 / Effects: `AbortSignal.any`; 更新 / updates `timeout`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async connectOnce(
    live: Live,
    key: Buffer,
    timeout: number,
    signal?: AbortSignal,
    agentPath?: string | BaseAgent,
  ) {
    signal?.throwIfAborted();
    const started = performance.now();
    const transportSignal = AbortSignal.any([...(signal ? [signal] : []),
      ...(live.network ? [live.network.signal] : []), ...(live.abort ? [live.abort.signal] : [])]);
    const socket = await networkRuntime.dial({ owner: 'core:vm-transport', purpose: this.host.closing ? 'vm-shutdown' : 'vm-session',
      ...(live.network ? { vmId: live.network.vmId, generation: live.network.generation } : {}) },
      { host: '127.0.0.1', port: live.sshPort }, transportSignal, timeout, !!this.host.closing);
    timeout = Math.max(1, timeout - (performance.now() - started));
    /**
     * 入口 / Entry: MachineTransport.connectOnce.callback@91.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: resolve; reject
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `setTimeout`; `live.clients.add`; `signal.addEventListener`; `client.connect`; `live.clients.delete`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `cleanup();`; `live.clients.delete(client);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `cleanup();`; `live.clients.delete(client);`; these statements determine whether a failure is absorbed or rejected again.
     */
    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      client.once('close', () => socket.destroy());
      /**
       * 入口 / Entry: MachineTransport.connectOnce.abort.
       * 功能：把本层请求转交 `client.destroy`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `client.destroy` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `client.destroy()`.
       * 副作用 / Effects: `client.destroy`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const abort = () => client.destroy();
      const timer = setTimeout(() => {
        reject(new Error('SSH connection timed out'));
        client.destroy();
      }, timeout);
      /**
       * 入口 / Entry: MachineTransport.connectOnce.cleanup.
       * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`MachineTransport`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `MachineTransport`; the calls and state transitions below complete the operation. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
       * 处理：通过 `clearTimeout`, `signal.removeEventListener` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `clearTimeout`, `signal.removeEventListener`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `clearTimeout`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      live.clients.add(client);
      signal?.addEventListener('abort', abort, { once: true });
      client.once('ready', () => {
        cleanup();
        resolve(client);
      });
      client.on('error', (error) => {
        cleanup();
        reject(error);
        client.end();
      });
      client.once('close', () => {
        cleanup();
        live.clients.delete(client);
        reject(new Error('SSH connection closed'));
      });
      try {
        client.connect({
          sock: socket,
          username: 'root',
          privateKey: key,
          readyTimeout: timeout,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
          ...(agentPath
            ? {
                agent: agentPath,
                agentForward: true,
                // Forwarded task credentials never authenticate the VM's root login.
                ...(typeof agentPath === 'string' ? {} : { authHandler: ['publickey'] }),
              }
            : {}),
        });
        socket.resume();
      } catch (error) {
        cleanup();
        live.clients.delete(client);
        client.destroy();
        socket.destroy();
        reject(error);
      }
    });
  }
  /**
   * 入口 / Entry: MachineTransport.exec.
   * 功能：把本层请求转交 `this.execChannel`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.execChannel` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; command: string; timeout: default=30000; signal: AbortSignal optional; output: (data: string) => void optional; agentPath: string | BaseAgent optional
   * 输出 / Returns: `this.execChannel(id, command, timeout, signal, output, agentPath)`.
   * 副作用 / Effects: `this.execChannel`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async exec(
    id: string,
    command: string,
    timeout = 30000,
    signal?: AbortSignal,
    output?: (data: string) => void,
    agentPath?: string | BaseAgent,
  ) {
    return this.execChannel(id, command, timeout, signal, output, agentPath);
  }
  /** Bounded command input stays on the SSH channel, outside the guest argv. */
  /**
   * 入口 / Entry: MachineTransport.execInput.
   * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.execChannel(id, command, timeout, signal, output, agentPath, Buffer.from(input))` 供上层消费（`MachineTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `this.execChannel(id, command, timeout, signal, output, agentPath, Buffer.from(input))` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
   * 处理：通过 `this.execChannel` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.execChannel`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; command: string; input: Buffer; timeout: default=30000; signal: AbortSignal optional; output: (data: string) => void optional; agentPath: string | BaseAgent optional
   * 输出 / Returns: `this.execChannel(id, command, timeout, signal, output, agentPath, Buffer.from(input))`.
   * 副作用 / Effects: `this.execChannel`.
   * 拒绝 / Refusals: 条件 / conditions `!Buffer.isBuffer(input) || input.length > 128 * 1024`; 异常 / errors `new AppError('命令输入超过 128 KiB 或类型无效', 413, 'GUEST_INPUT_INVALID')`.
   */
  async execInput(
    id: string,
    command: string,
    input: Buffer,
    timeout = 30000,
    signal?: AbortSignal,
    output?: (data: string) => void,
    agentPath?: string | BaseAgent,
  ) {
    if (!Buffer.isBuffer(input) || input.length > 128 * 1024)
      throw new AppError('命令输入超过 128 KiB 或类型无效', 413, 'GUEST_INPUT_INVALID');
    // Capture before connecting so callers cannot change an in-flight payload.
    return this.execChannel(id, command, timeout, signal, output, agentPath, Buffer.from(input));
  }
  /**
   * 入口 / Entry: MachineTransport.execChannel.
   * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => { let stdout = '', stderr = '', size…` 供上层消费（`MachineTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => { let stdout = '', stderr = '', size…` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
   * 处理：通过 `this.host.connect`, `client.end` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.host.connect`, `client.end`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; command: string; timeout: number; signal: AbortSignal optional; output: (data: string) => void optional; agentPath: string | BaseAgent optional; input: Buffer optional
   * 输出 / Returns: `await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => { let stdout = '', stderr = '', size…`.
   * 副作用 / Effects: `this.host.connect`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `client.end();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `client.end();`; these steps also apply to exceptional exits.
   */
  private async execChannel(
    id: string,
    command: string,
    timeout: number,
    signal?: AbortSignal,
    output?: (data: string) => void,
    agentPath?: string | BaseAgent,
    input?: Buffer,
  ) {
    const client = await this.host.connect(id, Math.min(timeout, 10000), signal, agentPath);
    try {
      /**
       * 入口 / Entry: MachineTransport.execChannel.callback@182.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `setTimeout`; `signal.addEventListener`; `abort`; `client.exec`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
        let stdout = '',
          stderr = '',
          size = 0;
        let settled = false;
        const outDecoder = new StringDecoder('utf8'),
          errDecoder = new StringDecoder('utf8');
        /**
         * 入口 / Entry: MachineTransport.execChannel.finish.
         * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`MachineTransport`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `void` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
         * 处理：通过 `clearTimeout`, `signal.removeEventListener`, `client.off`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `clearTimeout`, `signal.removeEventListener`, `client.off`, `reject`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `settled`.
         * 输入 / Inputs: error: Error optional; code: default=-1
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `clearTimeout`; 更新 / updates `settled`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const finish = (error?: Error, code = -1) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          client.off('close', closed);
          error
            ? reject(error)
            : resolve({ stdout: stdout + outDecoder.end(), stderr: stderr + errDecoder.end(), code });
        };
        /**
         * 入口 / Entry: MachineTransport.execChannel.abort.
         * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`MachineTransport`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `MachineTransport`; the calls and state transitions below complete the operation. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
         * 处理：通过 `finish`, `client.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `finish`, `client.destroy`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `client.destroy`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const abort = () => {
          finish(new AppError('Linux 命令已取消', 409));
          client.destroy();
        };
        /**
         * 入口 / Entry: MachineTransport.execChannel.closed.
         * 功能：把本层请求转交 `finish`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `finish` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `finish(new Error('SSH connection closed'))`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const closed = () => finish(new Error('SSH connection closed'));
        const timer = setTimeout(() => {
          finish(new AppError('Linux 命令执行超时', 408));
          client.destroy();
        }, timeout);
        signal?.addEventListener('abort', abort, { once: true });
        client.once('close', closed);
        if (signal?.aborted) {
          abort();
          return;
        }
        /**
         * 入口 / Entry: MachineTransport.execChannel.completed.
         * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`MachineTransport`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `void` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
         * 处理：通过 `finish`, `stream.close`, `stream.on`, `stream.stderr.on` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `finish`, `stream.close`, `stream.on`, `stream.stderr.on`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `error`; `settled`; `input !== undefined`.
         * 输入 / Inputs: error; stream
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `stream.close`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 失败处理：catch 分支执行 `finish(error instanceof Error ? error : new Error('SSH command input failed'));`; `stream.close();`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `finish(error instanceof Error ? error : new Error('SSH command input failed'));`; `stream.close();`; these statements determine whether a failure is absorbed or rejected again.
         */
        const completed: ClientCallback = (error, stream) => {
          if (error) {
            finish(error);
            return;
          }
          if (settled) {
            stream.close();
            return;
          }
          /**
           * 入口 / Entry: MachineTransport.execChannel.collect.
           * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`MachineTransport`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `void` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
           * 处理：通过 `finish`, `stream.close`, `inline.write`, `output` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `finish`, `stream.close`, `inline.write`, `output`; the branches below determine continuation, return or refusal.
           * 分支 / Branches: `settled`; `size > 1024 * 1024`; `err`.
           * 输入 / Inputs: data: Buffer; err: default=false
           * 输出 / Returns: `void`.
           * 副作用 / Effects: `stream.close`; `inline.write`; 更新 / updates `size`, `stderr`, `stdout`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const collect = (data: Buffer, err = false) => {
            if (settled) return;
            size += data.length;
            if (size > 1024 * 1024) {
              finish(new AppError('输出超过 1 MiB，请使用终端'));
              stream.close();
              return;
            }
            const text = (err ? errDecoder : outDecoder).write(data);
            if (err) stderr += text;
            else stdout += text;
            output?.(text);
          };
          stream.on('data', (data: Buffer) => collect(data));
          stream.stderr.on('data', (data: Buffer) => collect(data, true));
          stream.on('error', (e: Error) => finish(e));
          stream.on('close', (code: number) => {
            finish(undefined, code ?? -1);
          });
          if (input !== undefined) {
            try {
              stream.end(input);
            } catch (error) {
              finish(error instanceof Error ? error : new Error('SSH command input failed'));
              stream.close();
            }
          }
        };
        if (agentPath) client.exec(command, { agentForward: true } as ExecOptions, completed);
        else client.exec(command, completed);
      });
    } finally {
      client.end();
    }
  }
  /**
   * 入口 / Entry: MachineTransport.openGuestTcpStream.
   * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `channel` 供上层消费（`MachineTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `channel` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
   * 处理：通过 `inline.join`, `projectNetworkCommand`, `this.host.connect`, `channel.on` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.join`, `projectNetworkCommand`, `this.host.connect`, `channel.on`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `signal?.aborted`.
   * 输入 / Inputs: id: string; port: number; signal: AbortSignal optional; project: Project optional
   * 输出 / Returns: Promise<Duplex>；结果来自 / values from `channel`.
   * 副作用 / Effects: `this.host.connect`; `signal.addEventListener`; `abort`; `client.destroy`.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isInteger(port) || port < 1 || port > 65535`; 异常 / errors `new AppError('客户机端口无效')`; `error`.
   * 失败处理：catch 分支执行 `client.destroy();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `client.destroy();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async openGuestTcpStream(
    id: string,
    port: number,
    signal?: AbortSignal,
    project?: Project,
  ): Promise<Duplex> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError('客户机端口无效');
    const script = [
      'import socket,sys,threading',
      `sock=socket.create_connection(("127.0.0.1",${port}),5)`,
      'sock.settimeout(None)',
      'def upstream():',
      '  try:',
      '    while True:',
      '      data=sys.stdin.buffer.read1(16384)',
      '      if not data: break',
      '      sock.sendall(data)',
      '  finally:',
      '    try: sock.shutdown(socket.SHUT_WR)',
      '    except OSError: pass',
      'threading.Thread(target=upstream,daemon=True).start()',
      'try:',
      '  while True:',
      '    data=sock.recv(16384)',
      '    if not data: break',
      '    sys.stdout.buffer.write(data)',
      '    sys.stdout.buffer.flush()',
      'finally: sock.close()',
    ].join('\n');
    const payload = Buffer.from(script).toString('base64');
    const relay = `python3 -I -S -u -c "import base64;exec(base64.b64decode('${payload}'))"`;
    const command = project ? projectNetworkCommand(project, `exec ${relay}`) : relay;
    const client = await this.host.connect(id, 10000, signal);
    try {
      /**
       * 入口 / Entry: MachineTransport.openGuestTcpStream.callback@292.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: `abortPending()`.
       * 副作用 / Effects: `signal.addEventListener`; `abortPending`; `client.exec`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const channel = await new Promise<Duplex>((resolve, reject) => {
        let settled = false;
        /**
         * 入口 / Entry: MachineTransport.openGuestTcpStream.finish.
         * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`MachineTransport`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `void` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
         * 处理：通过 `stream.destroy`, `signal.removeEventListener`, `client.off`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `stream.destroy`, `signal.removeEventListener`, `client.off`, `reject`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `settled`.
         * 输入 / Inputs: error: Error optional; stream: Duplex optional
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `stream.destroy`; 更新 / updates `settled`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const finish = (error?: Error, stream?: Duplex) => {
          if (settled) {
            stream?.destroy();
            return;
          }
          settled = true;
          signal?.removeEventListener('abort', abortPending);
          client.off('close', closedPending);
          error ? reject(error) : resolve(stream!);
        };
        /**
         * 入口 / Entry: MachineTransport.openGuestTcpStream.abortPending.
         * 功能：把本层请求转交 `finish`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `finish` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `finish(new AppError('临时隧道连接已取消', 409))`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const abortPending = () => finish(new AppError('临时隧道连接已取消', 409));
        /**
         * 入口 / Entry: MachineTransport.openGuestTcpStream.closedPending.
         * 功能：把本层请求转交 `finish`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `finish` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `finish(new Error('SSH connection closed'))`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const closedPending = () => finish(new Error('SSH connection closed'));
        signal?.addEventListener('abort', abortPending, { once: true });
        client.once('close', closedPending);
        if (signal?.aborted) return abortPending();
        client.exec(command, (error, stream) => finish(error || undefined, stream));
      });
      channel.on('error', () => channel.destroy());
      (channel as typeof channel & { stderr?: {
      /**
       * 签名 / Signature: MachineTransport.openGuestTcpStream.resume.
       * 功能：为管理实例 SSH 连接、命令、输入和文件传输声明 resume 的输入与结果契约，所属容器为 MachineTransport.openGuestTcpStream。
       * Purpose: Declares the input/result contract for resume in MachineTransport.openGuestTcpStream. Module responsibility: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: void.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      resume(): void } }).stderr?.resume();
      /**
       * 入口 / Entry: MachineTransport.openGuestTcpStream.abort.
       * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`MachineTransport`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `MachineTransport`; the calls and state transitions below complete the operation. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
       * 处理：通过 `channel.destroy`, `client.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `channel.destroy`, `client.destroy`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `channel.destroy`; `client.destroy`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const abort = () => {
        channel.destroy();
        client.destroy();
      };
      signal?.addEventListener('abort', abort, { once: true });
      channel.once('close', () => {
        signal?.removeEventListener('abort', abort);
        client.end();
      });
      if (signal?.aborted) abort();
      return channel;
    } catch (error) {
      client.destroy();
      throw error;
    }
  }
  /**
   * 入口 / Entry: MachineTransport.sftp.
   * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await new Promise<T>((resolve, reject) => { let settled = false; finish = (error, result) => { if (settled) return; settled =…` 供上层消费（`MachineTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `await new Promise<T>((resolve, reject) => { let settled = false; finish = (error, result) => { if (settled) return; settled =…` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
   * 处理：通过 `this.host.connect`, `signal.removeEventListener`, `client.off`, `client.end` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.host.connect`, `signal.removeEventListener`, `client.off`, `client.end`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; work: (sftp: SFTPWrapper, transportSignal?: AbortSignal) => Promise<T>; signal: AbortSignal optional
   * 输出 / Returns: `await new Promise<T>((resolve, reject) => { let settled = false; finish = (error, result) => { if (settled) return; settled =…`.
   * 副作用 / Effects: `this.host.connect`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `signal?.removeEventListener('abort', abort);`; `client.off('close', closed);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `signal?.removeEventListener('abort', abort);`; `client.off('close', closed);`; these steps also apply to exceptional exits.
   */
  async sftp<T>(
    id: string,
    work: (sftp: SFTPWrapper, transportSignal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ) {
    const client = await this.host.connect(id, 10000, signal);
    const transport = new AbortController();
    let finish!:
    /**
     * 中文功能：结束原 SFTP 工作的错误/可选结果通道。
     * English: Error/optional-result completion channel for the original SFTP operation.
     * 所属 / Owner: MachineTransport.sftp.finish.
     * 输入 / Inputs: error: unknown; result?: T.
     * 结果 / Result: `void`.
     */
    (error: unknown, result?: T) => void;
    /**
     * 入口 / Entry: MachineTransport.sftp.failed.
     * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`MachineTransport`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; the calls and state transitions below complete the operation. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
     * 处理：通过 `transport.abort`, `finish`, `client.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `transport.abort`, `finish`, `client.destroy`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: error: Error
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `transport.abort`; `client.destroy`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const failed = (error: Error) => {
      transport.abort(error);
      finish(error);
      client.destroy();
    };
    /**
     * 入口 / Entry: MachineTransport.sftp.closed.
     * 功能：把本层请求转交 `failed`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `failed` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `failed(new Error('SFTP connection closed'))`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const closed = () => failed(new Error('SFTP connection closed'));
    /**
     * 入口 / Entry: MachineTransport.sftp.abort.
     * 功能：把本层请求转交 `failed`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `failed` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `failed(signal?.reason || new AppError('文件操作已取消', 409))`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abort = () => failed(signal?.reason || new AppError('文件操作已取消', 409));
    try {
      /**
       * 入口 / Entry: MachineTransport.sftp.callback@345.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `signal.addEventListener`; `abort`; 更新 / updates `finish`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        /**
         * 入口 / Entry: MachineTransport.sftp.finish.
         * 功能：在管理实例 SSH 连接、命令、输入和文件传输中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`MachineTransport`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `MachineTransport`; this entry produces `void` for its caller. Module context: Owns VM SSH connections, commands, input and file transfers under state/original-runtime identity checks.
         * 处理：通过 `reject`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `reject`, `resolve`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `settled`.
         * 输入 / Inputs: error; result
         * 输出 / Returns: `void`.
         * 副作用 / Effects: 更新 / updates `settled`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        finish = (error, result) => {
          if (settled) return;
          settled = true;
          error ? reject(error) : resolve(result as T);
        };
        signal?.addEventListener('abort', abort, { once: true });
        client.once('close', closed);
        client.on('error', failed);
        if (signal?.aborted) {
          abort();
          return;
        }
        /**
         * 入口 / Entry: MachineTransport.sftp.callback@359.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（client.sftp）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (client.sftp).
         * 输入 / Inputs: error; ftp
         * 输出 / Returns: `void`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        client.sftp((error, ftp) => {
          if (error) {
            failed(error);
            return;
          }
          // ssh2 may leave requests queued forever if a finally block submits
          // cleanup after disconnection. Transport failure must settle this
          // operation independently of those request callbacks.
          ftp.on('error', failed);
          ftp.once('close', closed);
          ftp.once('end', closed);
          if (settled) {
            ftp.end();
            return;
          }
          Promise.resolve()
            .then(() => work(ftp, transport.signal))
            .then((result) => finish(undefined, result), failed);
        });
      });
    } finally {
      signal?.removeEventListener('abort', abort);
      client.off('close', closed);
      client.off('error', failed);
      client.end();
    }
  }
}
