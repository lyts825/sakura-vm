/**
 * 模块职责：处理 LSP 分帧、通知及请求关联，连接退出时结束未完成请求。
 * Module purpose: Implements LSP framing, notifications and request correlation, rejecting pending work when the connection exits.
 */
import type { Duplex } from 'node:stream';
import { AppError } from '../shared/errors.ts';

type Pending = {
/**
 * 签名 / Signature: Pending.resolve.
 * 功能：为处理 LSP 分帧、通知及请求关联声明 resolve 的输入与结果契约，所属容器为 Pending。
 * Purpose: Declares the input/result contract for resolve in Pending. Module responsibility: Implements LSP framing, notifications and request correlation, rejecting pending work when the connection exits.
 * 输入 / Inputs: value: any
 * 输出 / Returns: void.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
resolve: (value: any) => void;
/**
 * 签名 / Signature: Pending.reject.
 * 功能：为处理 LSP 分帧、通知及请求关联声明 reject 的输入与结果契约，所属容器为 Pending。
 * Purpose: Declares the input/result contract for reject in Pending. Module responsibility: Implements LSP framing, notifications and request correlation, rejecting pending work when the connection exits.
 * 输入 / Inputs: error: Error
 * 输出 / Returns: void.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
reject: (error: Error) => void };

/** A bounded JSON-RPC 2.0 connection over a language server's stdio channel. */
export class LspTransport {
  private input = Buffer.alloc(0);
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private closed = false;
  private listeners = new Set<
  /**
   * 中文功能：接受语言服务通知 method 与 params 的订阅者。
   * English: Subscriber receiving language-service notification methods and parameters.
   * 所属 / Owner: LspTransport.listeners.
   * 输入 / Inputs: method: string; params: any.
   * 结果 / Result: `void`.
   */
  (method: string, params: any) => void>();
  /**
   * 入口 / Entry: LspTransport.constructor.
   * 功能：建立 LspTransport 的处理 LSP 分帧、通知及请求关联上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the LspTransport context for this module's responsibility: Implements LSP framing, notifications and request correlation, rejecting pending work when the connection exits. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: stream: Duplex
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private stream: Duplex) {
    stream.on('data', (chunk: Buffer) => this.receive(Buffer.from(chunk)));
    stream.on('error', (error) => this.fail(error));
    stream.on('close', () => this.fail(new Error('语言服务器已退出')));
  }
  /**
   * 入口 / Entry: LspTransport.onNotification.
   * 功能：从当前输入或状态计算 `() => this.listeners.delete(listener)`，供调用方后续验证或使用。
   * Purpose: Computes `() => this.listeners.delete(listener)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: listener: (method: string, params: any) => void
   * 输出 / Returns: `() => this.listeners.delete(listener)`.
   * 副作用 / Effects: `this.listeners.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  onNotification(listener: (method: string, params: any) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /**
   * 入口 / Entry: LspTransport.send.
   * 功能：在处理 LSP 分帧、通知及请求关联中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`LspTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LspTransport`; the calls and state transitions below complete the operation. Module context: Implements LSP framing, notifications and request correlation, rejecting pending work when the connection exits.
   * 处理：通过 `this.stream.write` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stream.write`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: message: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stream.write`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `payload.length > 4 * 1024 ** 2`; 异常 / errors `new Error('语言服务器连接已关闭')`; `new AppError('语言服务请求过大', 413)`.
   */
  private send(message: unknown) {
    if (this.closed) throw new Error('语言服务器连接已关闭');
    const payload = Buffer.from(JSON.stringify(message));
    if (payload.length > 4 * 1024 ** 2) throw new AppError('语言服务请求过大', 413);
    this.stream.write(Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`), payload]));
  }
  /**
   * 入口 / Entry: LspTransport.notify.
   * 功能：在处理 LSP 分帧、通知及请求关联中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`LspTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LspTransport`; the calls and state transitions below complete the operation. Module context: Implements LSP framing, notifications and request correlation, rejecting pending work when the connection exits.
   * 处理：通过 `this.send` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.send`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: method: string; params: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.send`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  notify(method: string, params: unknown) { this.send({ jsonrpc: '2.0', method, params }); }
  /**
   * 入口 / Entry: LspTransport.request.
   * 功能：从当前输入或状态计算 `new Promise<any>((resolve, reject) => { this.pending.set(id, { resolve, reject }); try { this.send({ jsonrpc: '2.0', id, meth…`，供调用方后续验证或使用。
   * Purpose: Computes `new Promise<any>((resolve, reject) => { this.pending.set(id, { resolve, reject }); try { this.send({ jsonrpc: '2.0', id, meth…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: method: string; params: unknown
   * 输出 / Returns: `new Promise<any>((resolve, reject) => { this.pending.set(id, { resolve, reject }); try { this.send({ jsonrpc: '2.0', id, meth…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  request(method: string, params: unknown) {
    const id = ++this.sequence;
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  /**
   * 入口 / Entry: LspTransport.receive.
   * 功能：在处理 LSP 分帧、通知及请求关联中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `this.fail(new Error('语言服务器响应过大'))` 供上层消费（`LspTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LspTransport`; this entry produces `void` / `this.fail(new Error('语言服务器响应过大'))` for its caller. Module context: Implements LSP framing, notifications and request correlation, rejecting pending work when the connection exits.
   * 处理：通过 `this.fail`, `this.input.indexOf`, `inline.exec`, `this.input.subarray().toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.fail`, `this.input.indexOf`, `inline.exec`, `this.input.subarray().toString`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `this.input.length > 8 * 1024 ** 2`; `headerEnd < 0`.
   * 输入 / Inputs: chunk: Buffer
   * 输出 / Returns: `void`; `this.fail(new Error('语言服务器响应过大'))`; `this.fail(new Error('语言服务器响应长度无效'))`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `inline.exec`; 更新 / updates `this.input`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return this.fail(error as Error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return this.fail(error as Error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private receive(chunk: Buffer) {
    if (this.closed) return;
    this.input = Buffer.concat([this.input, chunk]);
    if (this.input.length > 8 * 1024 ** 2) return this.fail(new Error('语言服务器响应过大'));
    while (true) {
      const headerEnd = this.input.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        if (this.input.length > 8192) this.fail(new Error('语言服务器响应头过大'));
        return;
      }
      const length = /(?:^|\r\n)Content-Length: (\d+)(?:\r\n|$)/i.exec(this.input.subarray(0, headerEnd).toString('ascii'));
      const size = Number(length?.[1]);
      if (!length || !Number.isSafeInteger(size) || size > 4 * 1024 ** 2)
        return this.fail(new Error('语言服务器响应长度无效'));
      if (this.input.length < headerEnd + 4 + size) return;
      const bytes = this.input.subarray(headerEnd + 4, headerEnd + 4 + size);
      this.input = this.input.subarray(headerEnd + 4 + size);
      try { this.dispatch(JSON.parse(bytes.toString('utf8'))); }
      catch (error) { return this.fail(error as Error); }
    }
  }
  /**
   * 入口 / Entry: LspTransport.dispatch.
   * 功能：在处理 LSP 分帧、通知及请求关联中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`LspTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LspTransport`; this entry produces `void` for its caller. Module context: Implements LSP framing, notifications and request correlation, rejecting pending work when the connection exits.
   * 处理：通过 `message.params.items.map`, `this.send`, `listener`, `this.pending.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `message.params.items.map`, `this.send`, `listener`, `this.pending.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `typeof message?.method === 'string'`; `message.id !== undefined`; `!pending`.
   * 输入 / Inputs: message: any
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.send`; `listener`; `this.pending.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private dispatch(message: any) {
    if (typeof message?.method === 'string') {
      if (message.id !== undefined) {
        // Servers may request configuration or client capability registration.
        const result = message.method === 'workspace/configuration'
          ? Array.isArray(message.params?.items) ? message.params.items.map(() => ({})) : []
          : null;
        this.send({ jsonrpc: '2.0', id: message.id, result });
      } else for (const listener of this.listeners) listener(message.method, message.params);
      return;
    }
    const pending = this.pending.get(message?.id);
    if (!pending) return;
    this.pending.delete(message.id);
    message.error
      ? pending.reject(new Error(String(message.error.message || '语言服务器请求失败')))
      : pending.resolve(message.result);
  }
  /**
   * 入口 / Entry: LspTransport.fail.
   * 功能：在处理 LSP 分帧、通知及请求关联中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`LspTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LspTransport`; this entry produces `void` for its caller. Module context: Implements LSP framing, notifications and request correlation, rejecting pending work when the connection exits.
   * 处理：通过 `this.stream.destroy`, `this.pending.values`, `pending.reject`, `this.pending.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stream.destroy`, `this.pending.values`, `pending.reject`, `this.pending.clear`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`.
   * 输入 / Inputs: error: Error
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.stream.destroy`; `this.pending.clear`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.stream.destroy();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  /**
   * 入口 / Entry: LspTransport.close.
   * 功能：在处理 LSP 分帧、通知及请求关联中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`LspTransport`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `LspTransport`; the calls and state transitions below complete the operation. Module context: Implements LSP framing, notifications and request correlation, rejecting pending work when the connection exits.
   * 处理：通过 `this.fail` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.fail`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() { this.fail(new Error('语言服务器连接已关闭')); }
}
