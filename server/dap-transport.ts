/**
 * 模块职责：处理 DAP 分帧、请求关联及事件等待，限制消息大小并在断开时结束未完成请求。
 * Module purpose: Implements DAP framing, request correlation and event waits with message limits and rejection on disconnect.
 */
import type { Duplex } from 'node:stream';

type Waiter = {
/**
 * 签名 / Signature: Waiter.resolve.
 * 功能：为处理 DAP 分帧、请求关联及事件等待声明 resolve 的输入与结果契约，所属容器为 Waiter。
 * Purpose: Declares the input/result contract for resolve in Waiter. Module responsibility: Implements DAP framing, request correlation and event waits with message limits and rejection on disconnect.
 * 输入 / Inputs: value: any
 * 输出 / Returns: void.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
resolve: (value: any) => void;
/**
 * 签名 / Signature: Waiter.reject.
 * 功能：为处理 DAP 分帧、请求关联及事件等待声明 reject 的输入与结果契约，所属容器为 Waiter。
 * Purpose: Declares the input/result contract for reject in Waiter. Module responsibility: Implements DAP framing, request correlation and event waits with message limits and rejection on disconnect.
 * 输入 / Inputs: error: Error
 * 输出 / Returns: void.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
reject: (error: Error) => void; timer: NodeJS.Timeout };

/** A bounded Debug Adapter Protocol connection over one guest stdio channel. */
export class DapTransport {
  private input = Buffer.alloc(0);
  private sequence = 0;
  private pending = new Map<number, Waiter>();
  private events = new Map<string, any[]>();
  private eventWaiters = new Map<string, Waiter[]>();
  private listeners = new Set<
  /**
   * 中文功能：接受调试协议事件名与 body 的通知订阅者。
   * English: Subscriber receiving debug-protocol event names and bodies.
   * 所属 / Owner: DapTransport.listeners.
   * 输入 / Inputs: event: string; body: any.
   * 结果 / Result: `void`.
   */
  (event: string, body: any) => void>();
  private closed = false;
  /**
   * 入口 / Entry: DapTransport.constructor.
   * 功能：建立 DapTransport 的处理 DAP 分帧、请求关联及事件等待上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the DapTransport context for this module's responsibility: Implements DAP framing, request correlation and event waits with message limits and rejection on disconnect. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: stream: Duplex
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private stream: Duplex) {
    stream.on('data', (chunk: Buffer) => this.receive(Buffer.from(chunk)));
    stream.on('error', (error) => this.close(error));
    stream.on('close', () => this.close(new Error('调试适配器已退出')));
  }
  /**
   * 入口 / Entry: DapTransport.onEvent.
   * 功能：从当前输入或状态计算 `() => this.listeners.delete(listener)`，供调用方后续验证或使用。
   * Purpose: Computes `() => this.listeners.delete(listener)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: listener: (event: string, body: any) => void
   * 输出 / Returns: `() => this.listeners.delete(listener)`.
   * 副作用 / Effects: `this.listeners.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  onEvent(listener: (event: string, body: any) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /**
   * 入口 / Entry: DapTransport.send.
   * 功能：在处理 DAP 分帧、请求关联及事件等待中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`DapTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DapTransport`; the calls and state transitions below complete the operation. Module context: Implements DAP framing, request correlation and event waits with message limits and rejection on disconnect.
   * 处理：通过 `this.stream.write` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stream.write`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: message: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stream.write`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `bytes.length > 1024 ** 2`; 异常 / errors `new Error('调试适配器连接已关闭')`; `new Error('调试请求过大')`.
   */
  private send(message: unknown) {
    if (this.closed) throw new Error('调试适配器连接已关闭');
    const bytes = Buffer.from(JSON.stringify(message));
    if (bytes.length > 1024 ** 2) throw new Error('调试请求过大');
    this.stream.write(Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`), bytes]));
  }
  /**
   * 入口 / Entry: DapTransport.request.
   * 功能：从当前输入或状态计算 `new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(seq); reject(new Error(`调试请求超时：${comm…`，供调用方后续验证或使用。
   * Purpose: Computes `new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(seq); reject(new Error(`调试请求超时：${comm…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: command: string; args: unknown default={}; timeoutMs: default=15000
   * 输出 / Returns: Promise<any>；结果来自 / values from `new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(seq); reject(new Error(`调试请求超时：${comm…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  request(command: string, args: unknown = {}, timeoutMs = 15000): Promise<any> {
    const seq = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`调试请求超时：${command}`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      try { this.send({ seq, type: 'request', command, arguments: args }); }
      catch (error) { clearTimeout(timer); this.pending.delete(seq); reject(error); }
    });
  }
  /**
   * 入口 / Entry: DapTransport.waitFor.
   * 功能：在处理 DAP 分帧、请求关联及事件等待中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.reject(new Error('调试适配器连接已关闭'))` / `Promise.resolve(buffered.shift())` 供上层消费（`DapTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DapTransport`; this entry produces `Promise.reject(new Error('调试适配器连接已关闭'))` / `Promise.resolve(buffered.shift())` for its caller. Module context: Implements DAP framing, request correlation and event waits with message limits and rejection on disconnect.
   * 处理：通过 `Promise.reject`, `this.events.get`, `Promise.resolve`, `buffered.shift` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.reject`, `this.events.get`, `Promise.resolve`, `buffered.shift`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `buffered?.length`.
   * 输入 / Inputs: event: string; timeoutMs: default=15000
   * 输出 / Returns: Promise<any>；结果来自 / values from `Promise.reject(new Error('调试适配器连接已关闭'))`; `Promise.resolve(buffered.shift())`; `new Promise((resolve, reject) => { const timer = setTimeout(() => { const waiting = this.eventWaiters.get(event) || []; this.…`.
   * 副作用 / Effects: `buffered.shift`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  waitFor(event: string, timeoutMs = 15000): Promise<any> {
    if (this.closed) return Promise.reject(new Error('调试适配器连接已关闭'));
    const buffered = this.events.get(event);
    if (buffered?.length) return Promise.resolve(buffered.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiting = this.eventWaiters.get(event) || [];
        this.eventWaiters.set(event, waiting.filter((item) => item !== waiter));
        reject(new Error(`等待调试事件超时：${event}`));
      }, timeoutMs);
      const waiter = { resolve, reject, timer };
      this.eventWaiters.set(event, [...(this.eventWaiters.get(event) || []), waiter]);
    });
  }
  /**
   * 入口 / Entry: DapTransport.receive.
   * 功能：在处理 DAP 分帧、请求关联及事件等待中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `this.close(new Error('调试响应过大'))` 供上层消费（`DapTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DapTransport`; this entry produces `void` / `this.close(new Error('调试响应过大'))` for its caller. Module context: Implements DAP framing, request correlation and event waits with message limits and rejection on disconnect.
   * 处理：通过 `this.close`, `this.input.indexOf`, `inline.exec`, `this.input.subarray().toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.close`, `this.input.indexOf`, `inline.exec`, `this.input.subarray().toString`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `this.input.length > 8 * 1024 ** 2`; `end < 0`.
   * 输入 / Inputs: chunk: Buffer
   * 输出 / Returns: `void`; `this.close(new Error('调试响应过大'))`; `this.close(new Error('调试响应长度无效'))`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `this.close`; `inline.exec`; 更新 / updates `this.input`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return this.close(error as Error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return this.close(error as Error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private receive(chunk: Buffer) {
    if (this.closed) return;
    this.input = Buffer.concat([this.input, chunk]);
    if (this.input.length > 8 * 1024 ** 2) return this.close(new Error('调试响应过大'));
    while (true) {
      const end = this.input.indexOf('\r\n\r\n');
      if (end < 0) {
        if (this.input.length > 8192) this.close(new Error('调试响应头过大'));
        return;
      }
      const match = /(?:^|\r\n)Content-Length: (\d+)(?:\r\n|$)/i.exec(this.input.subarray(0, end).toString('ascii'));
      const size = Number(match?.[1]);
      if (!match || !Number.isSafeInteger(size) || size > 4 * 1024 ** 2)
        return this.close(new Error('调试响应长度无效'));
      if (this.input.length < end + 4 + size) return;
      const bytes = this.input.subarray(end + 4, end + 4 + size);
      this.input = this.input.subarray(end + 4 + size);
      try { this.dispatch(JSON.parse(bytes.toString('utf8'))); }
      catch (error) { return this.close(error as Error); }
    }
  }
  /**
   * 入口 / Entry: DapTransport.dispatch.
   * 功能：在处理 DAP 分帧、请求关联及事件等待中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`DapTransport`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DapTransport`; this entry produces `void` for its caller. Module context: Implements DAP framing, request correlation and event waits with message limits and rejection on disconnect.
   * 处理：通过 `this.pending.get`, `this.pending.delete`, `clearTimeout`, `pending.resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pending.get`, `this.pending.delete`, `clearTimeout`, `pending.resolve`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `message?.type === 'response'`; `!pending`; `message?.type === 'event' && typeof message.event === 'string'`.
   * 输入 / Inputs: message: any
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.pending.delete`; `clearTimeout`; `waiting.shift`; `this.events.set`; `listener`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private dispatch(message: any) {
    if (message?.type === 'response') {
      const pending = this.pending.get(message.request_seq);
      if (!pending) return;
      this.pending.delete(message.request_seq);
      clearTimeout(pending.timer);
      message.success ? pending.resolve(message.body || {})
        : pending.reject(new Error(String(message.message || message.body?.error?.format || '调试请求失败')));
    } else if (message?.type === 'event' && typeof message.event === 'string') {
      const waiting = this.eventWaiters.get(message.event);
      if (waiting?.length) {
        const waiter = waiting.shift()!;
        clearTimeout(waiter.timer);
        waiter.resolve(message.body || {});
      } else this.events.set(message.event, [...(this.events.get(message.event) || []).slice(-3), message.body || {}]);
      for (const listener of this.listeners) listener(message.event, message.body || {});
    } else if (message?.type === 'request' && Number.isInteger(message.seq)) {
      // internalConsole does not require a terminal; reject unexpected reverse requests.
      this.send({ seq: ++this.sequence, type: 'response', request_seq: message.seq,
        command: message.command, success: false, message: '此调试会话不支持外部终端请求' });
    }
  }
  /**
   * 入口 / Entry: DapTransport.close.
   * 功能：在处理 DAP 分帧、请求关联及事件等待中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`DapTransport`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `DapTransport`; this entry produces `void` for its caller. Module context: Implements DAP framing, request correlation and event waits with message limits and rejection on disconnect.
   * 处理：通过 `this.stream.destroy`, `this.pending.values`, `clearTimeout`, `waiter.reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stream.destroy`, `this.pending.values`, `clearTimeout`, `waiter.reject`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`.
   * 输入 / Inputs: error: default=new Error('调试适配器连接已关闭')
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.stream.destroy`; `clearTimeout`; `this.pending.clear`; `this.eventWaiters.clear`; `this.events.clear`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(error = new Error('调试适配器连接已关闭')) {
    if (this.closed) return;
    this.closed = true;
    this.stream.destroy();
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.pending.clear();
    for (const waiting of this.eventWaiters.values())
      for (const waiter of waiting) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.eventWaiters.clear();
    this.events.clear();
  }
}
