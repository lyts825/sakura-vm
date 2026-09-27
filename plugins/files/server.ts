export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { posix } from 'node:path';
import { z } from 'zod';
import { AppError, guestPath } from '../../server/model.ts';
import { readJsonBody, MAX_TEXT_REQUEST_BYTES } from '../../server/http.ts';
import { Files, MAX_TEXT_BYTES, textVersion } from '../../server/files.ts';
import { FileHistory } from '../../server/file-history.ts';
import { FileLocks } from '../../server/file-locks.ts';
import { downloadManifest } from '../../server/file-chunks.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.files = new Files(m);
  host.history = new FileHistory(m, host.files);
  host.fileLocks = new FileLocks();
  host.files.beforeReplace = (id, path, ftp, signal) => host.history.capture(id, path, ftp, signal);
  host.files.trash = (id, path, recursive) => host.history.trash(id, path, recursive);
  host.machines.fileBeforeReplace = host.files.beforeReplace;
}
export function deactivate(host: PluginContext) {
  host.machines.fileBeforeReplace = undefined;
  host.fileLocks?.clear();
  if (host.files) {
    host.files.beforeReplace = undefined;
    host.files.trash = undefined;
  }
}
export async function route(
  this: PluginContext,
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
  if (parts.length === 4 && action === 'download-chunks' && req.method === 'GET') {
    const path = guestPath(url.searchParams.get('path'));
    return send(
      url.searchParams.has('chunk')
        ? await this.files.chunk(id, path, Number(url.searchParams.get('chunk')), signal)
        : await downloadManifest(this.files, id, path, signal),
    );
  }
  if (parts.length === 4 && action === 'file-preview' && req.method === 'GET')
    return send(await this.files.preview(id, guestPath(url.searchParams.get('path')), signal));
  if (parts.length === 4 && action === 'file-lock') {
    const path = guestPath(url.searchParams.get('path'));
    if (req.method === 'GET') return send(this.fileLocks.view(id, path));
    if (req.method === 'POST') {
      const input = z.object({
        action: z.enum(['acquire', 'renew', 'release']),
        token: z.uuid().optional(),
      }).strict().parse(await body(req));
      if (this.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      if (input.action === 'acquire') {
        if (input.token) throw new AppError('获取文件锁时不能提供旧令牌');
        return send(await this.fileLocks.acquire(id, path));
      }
      if (!input.token) throw new AppError('需要文件锁令牌');
      return send(input.action === 'renew'
        ? await this.fileLocks.renew(id, path, input.token)
        : await this.fileLocks.release(id, path, input.token));
    }
  }
  if (parts.length === 4 && action === 'uploads') {
    this.machines.requireUnlocked(id);
    if (this.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
    const uploadId = url.searchParams.get('id');
    const lockToken = req.headers['x-sakura-file-lock'];
    if (lockToken !== undefined && (typeof lockToken !== 'string' || !z.uuid().safeParse(lockToken).success))
      throw new AppError('文件锁令牌无效');
    if (req.method === 'POST' && !uploadId)
      return send(await this.files.uploads.create(id, await body(req)), 201);
    if (!uploadId) throw new AppError('需要上传会话标识');
    if (req.method === 'GET') return send(await this.files.uploads.view(id, uploadId));
    if (req.method === 'DELETE') return send(await this.files.uploads.remove(id, uploadId));
    if (req.method === 'PUT') {
      if (!url.searchParams.has('chunk')) throw new AppError('需要分块索引');
      return send(
        await this.files.uploads.chunk(id, uploadId, Number(url.searchParams.get('chunk')), req, signal),
      );
    }
    if (req.method === 'POST') {
      const session = await this.files.uploads.view(id, uploadId);
      return send(await this.fileLocks.withMutation(id, [session.path], lockToken,
        () => this.files.uploads.commit(id, uploadId, signal)));
    }
  }
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
        lockToken: z.uuid().optional(),
      })
      .strict()
      .parse(await readJsonBody(req, MAX_TEXT_REQUEST_BYTES, signal));
    if (this.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
    await this.fileLocks.withMutation(id, [guestPath(value.path)], value.lockToken,
      () => this.machines.writeGuestFile(
        id,
        guestPath(value.path),
        value.content,
        value.overwrite,
        value.expectedVersion,
      ));
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
            lockToken: z.uuid().optional(),
          })
          .strict()
          .parse(await body(req));
        if (input.action === 'restore') {
          const entry = (await this.history.list(id)).find((item) => item.id === input.id);
          if (!entry) throw new AppError('历史记录不存在', 404);
          send(await this.fileLocks.withMutation(id, [entry.path], input.lockToken,
            () => this.history.restore(id, input.id, input.expectedVersion)));
        } else send(await this.history.purge(id, input.id));
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'transfer') {
      const path = guestPath(url.searchParams.get('path'));
      if (req.method === 'PUT') {
        const lockToken = req.headers['x-sakura-file-lock'];
        if (lockToken !== undefined && (typeof lockToken !== 'string' || !z.uuid().safeParse(lockToken).success))
          throw new AppError('文件锁令牌无效');
        send(await this.fileLocks.withMutation(id, [path], lockToken,
          () => this.files.upload(id, path, req, url.searchParams.get('overwrite') === '1', signal)));
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
          lockToken: z.uuid().optional(),
        })
        .strict()
        .parse(await body(req));
      send(await this.fileLocks.withMutation(id,
        [input.path, ...(input.destination ? [input.destination] : [])], input.lockToken,
        () => this.files.operation(id, input.action, input.path, input.destination, input.recursive)));
      return true;
    }
  }
  return false;
}
