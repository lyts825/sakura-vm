import type { Duplex } from 'node:stream';
import { AppError } from './model.ts';

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

/** A bounded JSON-RPC 2.0 connection over a language server's stdio channel. */
export class LspTransport {
  private input = Buffer.alloc(0);
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private closed = false;
  private listeners = new Set<(method: string, params: any) => void>();
  constructor(private stream: Duplex) {
    stream.on('data', (chunk: Buffer) => this.receive(Buffer.from(chunk)));
    stream.on('error', (error) => this.fail(error));
    stream.on('close', () => this.fail(new Error('语言服务器已退出')));
  }
  onNotification(listener: (method: string, params: any) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private send(message: unknown) {
    if (this.closed) throw new Error('语言服务器连接已关闭');
    const payload = Buffer.from(JSON.stringify(message));
    if (payload.length > 4 * 1024 ** 2) throw new AppError('语言服务请求过大', 413);
    this.stream.write(Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`), payload]));
  }
  notify(method: string, params: unknown) { this.send({ jsonrpc: '2.0', method, params }); }
  request(method: string, params: unknown) {
    const id = ++this.sequence;
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
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
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.stream.destroy();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  close() { this.fail(new Error('语言服务器连接已关闭')); }
}
