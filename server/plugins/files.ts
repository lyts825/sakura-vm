import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';
import { posix } from 'node:path';
import { z } from 'zod';
import { AppError, guestPath } from '../model.ts';
import { readJsonBody, MAX_TEXT_REQUEST_BYTES } from '../http.ts';
import { MAX_TEXT_BYTES, textVersion } from '../files.ts';
import { FileHistory } from '../file-history.ts';

export const services = ['history'] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.history = new FileHistory(m, host.files);
  host.files.beforeReplace = (id, path, ftp, signal) => host.history.capture(id, path, ftp, signal);
  host.files.trash = (id, path, recursive) => host.history.trash(id, path, recursive);
  host.machines.fileBeforeReplace = host.files.beforeReplace;
}
export function deactivate(host: Features) {
  host.machines.fileBeforeReplace = undefined;
  host.files.beforeReplace = undefined;
  host.files.trash = undefined;
}
export async function route(
  this: Features,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (req: IncomingMessage) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
    return true;
  };
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (req.method === 'GET' && parts.length === 4 && parts[3] === 'files')
    return send(await this.machines.files(id, guestPath(url.searchParams.get('path') || '/workspace')));
  if (req.method === 'GET' && parts.length === 4 && parts[3] === 'file') {
    const content = await this.machines.readGuestFile(id, guestPath(url.searchParams.get('path')));
    return send({ content, version: textVersion(content) });
  }
  if (req.method === 'PUT' && parts.length === 4 && parts[3] === 'file') {
    const value = z
      .object({
        path: z.string(),
        content: z.string().max(MAX_TEXT_BYTES),
        overwrite: z.boolean().default(true),
        expectedVersion: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .parse(await readJsonBody(req, MAX_TEXT_REQUEST_BYTES, signal));
    if (this.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
    await this.machines.writeGuestFile(
      id,
      guestPath(value.path),
      value.content,
      value.overwrite,
      value.expectedVersion,
    );
    return send({ ok: true, version: textVersion(value.content) });
  }
  if (parts.length === 4) {
    if (action === 'history') {
      if (req.method === 'GET') {
        if (url.searchParams.has('content'))
          send(await this.history.content(id, url.searchParams.get('content')!));
        else send({ items: await this.history.list(id, url.searchParams.get('path') || undefined) });
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['restore', 'purge']),
            id: z.uuid(),
            expectedVersion: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
          })
          .strict()
          .parse(await body(req));
        send(
          input.action === 'restore'
            ? await this.history.restore(id, input.id, input.expectedVersion)
            : await this.history.purge(id, input.id),
        );
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'transfer') {
      const path = guestPath(url.searchParams.get('path'));
      if (req.method === 'PUT') {
        send(await this.files.upload(id, path, req, url.searchParams.get('overwrite') === '1', signal));
        return true;
      }
      if (req.method === 'GET') {
        await this.downloads.send({ id, type: 'file', path, name: posix.basename(path) }, res);
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'file-operation' && req.method === 'POST') {
      const input = z
        .object({
          action: z.enum(['mkdir', 'rename', 'delete']),
          path: z.string(),
          destination: z.string().optional(),
          recursive: z.boolean().default(false),
        })
        .strict()
        .parse(await body(req));
      send(await this.files.operation(id, input.action, input.path, input.destination, input.recursive));
      return true;
    }
  }
  return false;
}
