/**
 * 模块职责：实现 QMP 与客户机代理请求，关联响应标识并管理连接、超时及快照任务等待。
 * Module purpose: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
 */
import { networkFor } from './network/index.ts';

import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const { connectLocal: createConnection, createServer } = networkFor('core:qmp');

/**
 * 入口 / Entry: freePort.
 * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `port` 供上层消费（`qmp.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `qmp.ts`; this entry produces `port` for its caller. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
 * 处理：通过 `createServer`, `server.listen`, `once`, `server.address` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createServer`, `server.listen`, `once`, `server.address`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `port`.
 * 副作用 / Effects: `createServer`; `server.listen`; `server.address`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res())));
  return port;
}
/**
 * 入口 / Entry: qmpOnce.
 * 功能：从当前输入或状态计算 `new Promise<unknown>((resolve, reject) => { const socket = createConnection({ host: '127.0.0.1', port }); socket.setEncoding(…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise<unknown>((resolve, reject) => { const socket = createConnection({ host: '127.0.0.1', port }); socket.setEncoding(…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: port: number; command: string; args: Record<string, unknown> | undefined; timeoutMs: number
 * 输出 / Returns: `new Promise<unknown>((resolve, reject) => { const socket = createConnection({ host: '127.0.0.1', port }); socket.setEncoding(…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
async function qmpOnce(port: number, command: string,
  args: Record<string, unknown> | undefined, timeoutMs: number) {
  /**
   * 入口 / Entry: qmpOnce.callback@22.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: resolve; reject
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `createConnection`; `socket.setEncoding`; `setTimeout`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return new Promise<unknown>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setEncoding('utf8');
    let input = '';
    let sent = false;
    let settled = false;
    const timer = setTimeout(() => finish(new Error('QMP response timed out')), timeoutMs);
    /**
     * 入口 / Entry: qmpOnce.finish.
     * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`qmp.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `qmp.ts`; this entry produces `void` for its caller. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
     * 处理：通过 `clearTimeout`, `socket.destroy`, `reject`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `clearTimeout`, `socket.destroy`, `reject`, `resolve`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `settled`.
     * 输入 / Inputs: error: Error optional; data: unknown optional
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `clearTimeout`; `socket.destroy`; 更新 / updates `settled`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    function finish(error?: Error, data?: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(data);
    }
    socket.on('error', (e) => finish(e));
    socket.on('close', () => finish(new Error('QMP closed')));
    /**
     * 入口 / Entry: qmpOnce.callback@38.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（socket.on / data）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (socket.on / data).
     * 输入 / Inputs: data
     * 输出 / Returns: `void`; `finish(new Error('Invalid QMP response'))`; `finish(new Error(msg.error.desc || 'QMP negotiation failed'))`；另有分支返回 / additional branch-specific returns.
     * 副作用 / Effects: `socket.write`; 更新 / updates `input`, `index`, `msg`, `sent`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `return finish(new Error('Invalid QMP response'));`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `return finish(new Error('Invalid QMP response'));`; these statements determine whether a failure is absorbed or rejected again.
     */
    socket.on('data', (data) => {
      if (settled) return;
      input += data;
      let index: number;
      while ((index = input.indexOf('\n')) >= 0) {
        const line = input.slice(0, index);
        input = input.slice(index + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return finish(new Error('Invalid QMP response'));
        }
        if (msg === null || typeof msg !== 'object' || Array.isArray(msg))
          return finish(new Error('Invalid QMP response'));
        if (msg.QMP) socket.write(JSON.stringify({ execute: 'qmp_capabilities', id: 'hello' }) + '\n');
        if (msg.id === 'hello' && !sent) {
          if (msg.error) return finish(new Error(msg.error.desc || 'QMP negotiation failed'));
          sent = true;
          socket.write(JSON.stringify({ execute: command, arguments: args, id: 'command' }) + '\n');
        }
        if (msg.id === 'command')
          return finish(msg.error ? new Error(msg.error.desc) : undefined, msg.return);
      }
    });
  });
}

/**
 * 入口 / Entry: qmp.
 * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await qmpOnce(port, command, args, Math.max(1, deadline - Date.now()))` 供上层消费（`qmp.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `qmp.ts`; this entry produces `await qmpOnce(port, command, args, Math.max(1, deadline - Date.now()))` for its caller. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
 * 处理：通过 `qmpOnce`, `delay` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `qmpOnce`, `delay`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: port: number; command: string; args: Record<string, unknown> optional; timeoutMs: default=5000
 * 输出 / Returns: `await qmpOnce(port, command, args, Math.max(1, deadline - Date.now()))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' || attempts >= 19 || Date.now() + 50 >= deadline`; 异常 / errors `error`.
 * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' || attempts >= 19 || Date.now() + 50 >= deadline) throw error;`; `await delay(50);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' || attempts >= 19 || Date.now() + 50 >= deadline) throw error;`; `await delay(50);`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function qmp(port: number, command: string,
  args?: Record<string, unknown>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (let attempts = 0; ; attempts++) {
    try { return await qmpOnce(port, command, args, Math.max(1, deadline - Date.now())); }
    catch (error) {
      // QEMU's socket chardev may briefly stop accepting while the previous
      // short-lived QMP client disconnects. ECONNREFUSED occurs before any
      // command bytes are sent, so retrying cannot execute a mutation twice.
      if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' ||
          attempts >= 19 || Date.now() + 50 >= deadline) throw error;
      await delay(50);
    }
  }
}

/** Snapshot QMP commands enqueue jobs; their immediate reply is not completion. */
/**
 * 入口 / Entry: qmpSnapshotJob.
 * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`qmp.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `qmp.ts`; this entry produces `void` for its caller. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
 * 处理：通过 `qmp`, `blocks.some`, `blocks.find`, `randomUUID` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `qmp`, `blocks.some`, `blocks.find`, `randomUUID`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: port: number; command: 'snapshot-save' | 'snapshot-load'; tag: string; timeoutMs: default=5 * 60_000
 * 输出 / Returns: `void`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!Array.isArray(blocks)`; `blocks.some((block) => block && typeof block === 'object' && block.device !== 'sakura-disk' && block.inserted && !block.inser…`; `typeof node !== 'string' || disk.inserted.drv !== 'qcow2' || disk.inserted.ro`; 异常 / errors `new Error('QMP did not return block devices')`; `new Error('Additional writable block devices are not supported by VM-state snapshots')`.
 */
export async function qmpSnapshotJob(port: number, command: 'snapshot-save' | 'snapshot-load',
  tag: string, timeoutMs = 5 * 60_000) {
  const blocks = await qmp(port, 'query-block', undefined, 10_000);
  if (!Array.isArray(blocks)) throw new Error('QMP did not return block devices');
  if (blocks.some((block) => block && typeof block === 'object' &&
      block.device !== 'sakura-disk' && block.inserted && !block.inserted.ro))
    throw new Error('Additional writable block devices are not supported by VM-state snapshots');
  const disk = blocks.find((block) => block && typeof block === 'object' &&
    block.device === 'sakura-disk');
  const node = disk?.inserted?.['node-name'];
  if (typeof node !== 'string' || disk.inserted.drv !== 'qcow2' || disk.inserted.ro)
    throw new Error('Sakura writable QCOW2 disk node is unavailable');
  const id = `sakura-${command}-${randomUUID()}`;
  await qmp(port, command, { 'job-id': id, tag, vmstate: node,
    devices: [node] }, 30_000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await qmp(port, 'query-jobs', undefined, 10_000);
    if (!Array.isArray(result)) throw new Error('QMP did not return snapshot jobs');
    const job = result.find((item) => item && typeof item === 'object' && item.id === id);
    if (job?.status === 'concluded') {
      await qmp(port, 'job-dismiss', { id }, 10_000);
      if (job.error) throw new Error(String(job.error));
      return;
    }
    await delay(250);
  }
  await qmp(port, 'job-cancel', { id }, 10_000).catch(() => {});
  throw new Error('QMP snapshot job timed out');
}

/** Keep one guest-agent connection open across freeze, snapshot and thaw. */
export class GuestAgent {
  private input = '';
  private sequence = 0;
  private readonly session = randomUUID();
  private pending?: { id: string;
  /**
   * 签名 / Signature: GuestAgent.resolve.
   * 功能：为实现 QMP 与客户机代理请求声明 resolve 的输入与结果契约，所属容器为 GuestAgent。
   * Purpose: Declares the input/result contract for resolve in GuestAgent. Module responsibility: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  resolve: (value: unknown) => void;
  /**
   * 签名 / Signature: GuestAgent.reject.
   * 功能：为实现 QMP 与客户机代理请求声明 reject 的输入与结果契约，所属容器为 GuestAgent。
   * Purpose: Declares the input/result contract for reject in GuestAgent. Module responsibility: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
   * 输入 / Inputs: error: Error
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  reject: (error: Error) => void };
  /**
   * 入口 / Entry: GuestAgent.constructor.
   * 功能：建立 GuestAgent 的实现 QMP 与客户机代理请求上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the GuestAgent context for this module's responsibility: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: socket: ReturnType<typeof createConnection>
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `socket.setEncoding`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private constructor(private readonly socket: ReturnType<typeof createConnection>) {
    socket.setEncoding('utf8');
    /**
     * 入口 / Entry: GuestAgent.constructor.callback@123.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（socket.on / data）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (socket.on / data).
     * 输入 / Inputs: chunk: string
     * 输出 / Returns: `this.fail(new Error('Guest agent response is too large'))`.
     * 副作用 / Effects: `this.input.slice().replace`; 更新 / updates `this.input`, `index`, `this.pending`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `this.fail(error instanceof Error ? error : new Error(String(error)));`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.fail(error instanceof Error ? error : new Error(String(error)));`; these statements determine whether a failure is absorbed or rejected again.
     */
    socket.on('data', (chunk: string) => {
      this.input += chunk;
      if (this.input.length > 1024 * 1024) return this.fail(new Error('Guest agent response is too large'));
      let index: number;
      while ((index = this.input.indexOf('\n')) >= 0) {
        const line = this.input.slice(0, index).replace(/^\uFFFD/, '');
        this.input = this.input.slice(index + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id !== this.pending?.id) continue;
          const pending = this.pending!;
          this.pending = undefined;
          if (message.error) pending.reject(new Error(message.error.desc || 'Guest agent command failed'));
          else pending.resolve(message.return);
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('Guest agent connection closed')));
  }
  /**
   * 入口 / Entry: GuestAgent.connect.
   * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new GuestAgent(socket)` 供上层消费（`GuestAgent`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GuestAgent`; this entry produces `new GuestAgent(socket)` for its caller. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
   * 处理：通过 `createConnection`, `socket.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `createConnection`, `socket.destroy`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: port: number; timeoutMs: default=5000
   * 输出 / Returns: `new GuestAgent(socket)`.
   * 副作用 / Effects: `createConnection`; `socket.destroy`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `socket.destroy();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `socket.destroy();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  static async connect(port: number, timeoutMs = 5000) {
    const socket = createConnection({ host: '127.0.0.1', port });
    try {
      /**
       * 入口 / Entry: GuestAgent.connect.callback@149.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `setTimeout`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      await new Promise<void>((resolve, reject) => {
        /**
         * 入口 / Entry: GuestAgent.connect.cleanup.
         * 功能：在实现 QMP 与客户机代理请求中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`GuestAgent`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `GuestAgent`; the calls and state transitions below complete the operation. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
         * 处理：通过 `clearTimeout`, `socket.off` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `clearTimeout`, `socket.off`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `clearTimeout`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('connect', connected);
          socket.off('error', failed);
        };
        /**
         * 入口 / Entry: GuestAgent.connect.connected.
         * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`GuestAgent`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `GuestAgent`; the calls and state transitions below complete the operation. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
         * 处理：通过 `cleanup`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `cleanup`, `resolve`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const connected = () => { cleanup(); resolve(); };
        /**
         * 入口 / Entry: GuestAgent.connect.failed.
         * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`GuestAgent`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `GuestAgent`; the calls and state transitions below complete the operation. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
         * 处理：通过 `cleanup`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `cleanup`, `reject`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: error: Error
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const failed = (error: Error) => { cleanup(); reject(error); };
        const timer = setTimeout(() => failed(new Error('Guest agent connection timed out')), timeoutMs);
        socket.once('connect', connected);
        socket.once('error', failed);
      });
      return new GuestAgent(socket);
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }
  /**
   * 入口 / Entry: GuestAgent.execute.
   * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new Promise<unknown>((resolve, reject) => { const timer = setTimeout(() => { this.fail(new Error(`Guest agent ${command} time…` 供上层消费（`GuestAgent`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GuestAgent`; this entry produces `new Promise<unknown>((resolve, reject) => { const timer = setTimeout(() => { this.fail(new Error(`Guest agent ${command} time…` for its caller. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
   * 输入 / Inputs: command: string; args: Record<string, unknown> optional; timeoutMs: default=30000
   * 输出 / Returns: `new Promise<unknown>((resolve, reject) => { const timer = setTimeout(() => { this.fail(new Error(`Guest agent ${command} time…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.pending`; `this.socket.destroyed`; 异常 / errors `new Error('Guest agent command already in progress')`; `new Error('Guest agent connection closed')`.
   */
  async execute(command: string, args?: Record<string, unknown>, timeoutMs = 30000) {
    if (this.pending) throw new Error('Guest agent command already in progress');
    if (this.socket.destroyed) throw new Error('Guest agent connection closed');
    const id = `${this.session}:${++this.sequence}`;
    /**
     * 入口 / Entry: GuestAgent.execute.callback@171.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: resolve; reject
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `setTimeout`; `this.socket.write`; 更新 / updates `this.pending`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`Guest agent ${command} timed out`));
        this.socket.destroy();
      }, timeoutMs);
      this.pending = {
        id,
        /**
         * 入口 / Entry: GuestAgent.execute.resolve.
         * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`GuestAgent`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `GuestAgent`; the calls and state transitions below complete the operation. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
         * 处理：通过 `clearTimeout`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `clearTimeout`, `resolve`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: value
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `clearTimeout`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        /**
         * 入口 / Entry: GuestAgent.execute.reject.
         * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`GuestAgent`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `GuestAgent`; the calls and state transitions below complete the operation. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
         * 处理：通过 `clearTimeout`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `clearTimeout`, `reject`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: error
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `clearTimeout`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
      this.socket.write(JSON.stringify({ execute: command, arguments: args, id }) + '\n');
    });
  }
  /**
   * 入口 / Entry: GuestAgent.close.
   * 功能：在实现 QMP 与客户机代理请求中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`GuestAgent`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `GuestAgent`; the calls and state transitions below complete the operation. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
   * 处理：通过 `this.socket.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.socket.destroy`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.socket.destroy`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() { this.socket.destroy(); }
  /**
   * 入口 / Entry: GuestAgent.fail.
   * 功能：在实现 QMP 与客户机代理请求中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.pending`（`GuestAgent`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GuestAgent`; the outcome is recorded in `this.pending`. Module context: Implements QMP and guest-agent requests with response IDs, connection lifecycles, timeouts and snapshot-job waits.
   * 处理：通过 `pending.reject`, `this.socket.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pending.reject`, `this.socket.destroy`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: error: Error
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.socket.destroy`; 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private fail(error: Error) {
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(error);
    this.socket.destroy();
  }
}
