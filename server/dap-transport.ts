import type { Duplex } from 'node:stream';

type Waiter = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** A bounded Debug Adapter Protocol connection over one guest stdio channel. */
export class DapTransport {
  private input = Buffer.alloc(0);
  private sequence = 0;
  private pending = new Map<number, Waiter>();
  private events = new Map<string, any[]>();
  private eventWaiters = new Map<string, Waiter[]>();
  private listeners = new Set<(event: string, body: any) => void>();
  private closed = false;
  constructor(private stream: Duplex) {
    stream.on('data', (chunk: Buffer) => this.receive(Buffer.from(chunk)));
    stream.on('error', (error) => this.close(error));
    stream.on('close', () => this.close(new Error('调试适配器已退出')));
  }
  onEvent(listener: (event: string, body: any) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private send(message: unknown) {
    if (this.closed) throw new Error('调试适配器连接已关闭');
    const bytes = Buffer.from(JSON.stringify(message));
    if (bytes.length > 1024 ** 2) throw new Error('调试请求过大');
    this.stream.write(Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`), bytes]));
  }
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
