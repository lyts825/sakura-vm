import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { posix } from 'node:path';
import { z } from 'zod';
import { AppError, guestPath } from './model.ts';
import type { Machines } from './machines.ts';
import type { Files } from './files.ts';
import type { Bundles } from './bundles.ts';

export const downloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), path: z.string() }).strict(),
  z.object({ type: z.literal('export') }).strict(),
]);
type DownloadTarget = z.infer<typeof downloadSchema> & { id: string; name: string };

// A ticket grants one download only; it never contains the controller token.
export class DownloadTickets {
  private tickets = new Map<string, { target: DownloadTarget; expiresAt: number }>();
  constructor(private now = Date.now) {}
  issue(target: DownloadTarget) {
    const now = this.now();
    for (const [key, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(key);
    if (this.tickets.size >= 64) throw new AppError('待下载任务过多，请稍后重试', 429);
    const key = randomBytes(32).toString('hex');
    const expiresAt = now + 60000;
    this.tickets.set(key, { target: { ...target }, expiresAt });
    return { url: `/api/downloads/${key}`, expiresAt };
  }
  take(key: string) {
    const ticket = this.tickets.get(key);
    this.tickets.delete(key);
    if (!ticket || ticket.expiresAt <= this.now()) throw new AppError('下载链接已失效，请重新点击下载', 410);
    return ticket.target;
  }
  clear() {
    this.tickets.clear();
  }
}

export class Downloads {
  private tickets = new DownloadTickets();
  private active = new Map<AbortController, Promise<void>>();
  private closed = false;
  constructor(
    private machines: Machines,
    private files: Files,
    private bundles: Bundles,
  ) {}
  async issue(id: string, input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const value = downloadSchema.parse(input);
    const vm = this.machines.get(id);
    if (value.type === 'file') {
      const path = guestPath(value.path);
      await this.files.info(id, path);
      if (this.closed) throw new AppError('服务正在关闭', 503);
      return this.tickets.issue({ id, type: 'file', path, name: posix.basename(path) });
    }
    this.machines.requireStopped(id);
    return this.tickets.issue({ id, type: 'export', name: vm.name + '.sakura' });
  }
  async route(req: IncomingMessage, res: ServerResponse, url: URL) {
    const match = /^\/api\/downloads\/([a-f0-9]{64})$/.exec(url.pathname);
    if (!match) return false;
    if (req.method !== 'GET') throw new AppError('下载仅支持 GET', 405);
    await this.send(this.tickets.take(match[1]), res);
    return true;
  }
  async send(target: DownloadTarget, res: ServerResponse) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    this.machines.get(target.id);
    const abort = new AbortController();
    const disconnected = () => {
      if (!res.writableFinished) abort.abort();
    };
    res.once('close', disconnected);
    const headers = (size?: number) =>
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(target.name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Accept-Ranges': 'none',
        ...(size === undefined ? {} : { 'Content-Length': size }),
      });
    const work = (async () => {
      if (res.destroyed) abort.abort();
      abort.signal.throwIfAborted();
      if (target.type === 'file')
        await this.files.download(target.id, target.path, res, headers, abort.signal);
      else await this.bundles.export(target.id, res, headers, abort.signal);
    })();
    this.active.set(abort, work);
    try {
      await work;
    } finally {
      res.off('close', disconnected);
      this.active.delete(abort);
    }
  }
  async close() {
    this.closed = true;
    this.tickets.clear();
    for (const abort of this.active.keys()) abort.abort();
    await Promise.allSettled(this.active.values());
  }
}
