/**
 * 模块职责：“文件工作台”插件服务端入口。激活时装配 Files、FileHistory、FileLocks，并处理声明的服务端操作。
 */
import { services as transfersServices } from '../transfers/services.ts';
import { services as migrationServices } from '../migration/services.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as filesServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { posix } from 'node:path';
import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';
import { guestPath } from '../../shared/paths.ts';
import { MAX_TEXT_REQUEST_BYTES } from '../../server/http.ts';
import { Files, textVersion } from '../../server/files.ts';
import { FileHistory } from '../../server/file-history.ts';
import { FileLocks } from '../../server/file-locks.ts';
import { downloadManifest } from '../../server/file-chunks.ts';

export async function activate(host: PluginContext) {
  const m = host.vm;
  const files = host.provide(filesServices.files, new Files(m));
  const history = host.provide(filesServices.history, new FileHistory(m, files));
  const locks = host.provide(filesServices.fileLocks, new FileLocks());
  const unregister = m.beforeFileReplace((id, path, ftp, signal) => history.capture(id, path, ftp, signal));
  files.trash = (id, path, recursive) => history.trash(id, path, recursive);
  // 文件历史钩子与 trash 替换属于本次激活；关闭时撤销并清空租约，防止旧插件实例继续拦截写入。
  host.onDispose(() => { unregister(); locks.clear(); files.trash = undefined; });
}
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (req: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4 && action === 'download-chunks' && req.method === 'GET') {
    const path = guestPath(url.searchParams.get('path'));
    return send(
      url.searchParams.has('chunk')
        ? await this.use(filesServices.files).chunk(id, path, Number(url.searchParams.get('chunk')), signal)
        : await downloadManifest(this.use(filesServices.files), id, path, signal),
    );
  }
  if (parts.length === 4 && action === 'file-preview' && req.method === 'GET')
    return send(await this.use(filesServices.files).preview(id, guestPath(url.searchParams.get('path')), signal));
  if (parts.length === 4 && action === 'file-lock') {
    const path = guestPath(url.searchParams.get('path'));
    if (req.method === 'GET') return send(this.use(filesServices.fileLocks).view(id, path));
    if (req.method === 'POST') {
      const input = httpRouteRequests["files.legacy.post.vms.vmId.file-lock"].parse(await body(req, signal));
      if (this.optional(migrationServices.migration)?.blocked) throw new AppError('数据目录迁移维护中', 409);
      if (input.action === 'acquire') {
        if (input.token) throw new AppError('获取文件锁时不能提供旧令牌');
        return send(await this.use(filesServices.fileLocks).acquire(id, path));
      }
      if (!input.token) throw new AppError('需要文件锁令牌');
      return send(input.action === 'renew'
        ? await this.use(filesServices.fileLocks).renew(id, path, input.token)
        : await this.use(filesServices.fileLocks).release(id, path, input.token));
    }
  }
  if (parts.length === 4 && action === 'uploads') {
    this.vm.requireUnlocked(id);
    if (this.optional(migrationServices.migration)?.blocked) throw new AppError('数据目录迁移维护中', 409);
    const uploadId = url.searchParams.get('id');
    const lockToken = req.headers['x-sakura-file-lock'];
    if (lockToken !== undefined && (typeof lockToken !== 'string' || !z.uuid().safeParse(lockToken).success))
      throw new AppError('文件锁令牌无效');
    if (req.method === 'POST' && !uploadId)
      return send(await this.use(filesServices.files).uploads.create(id, await body(req, signal)), 201);
    if (!uploadId) throw new AppError('需要上传会话标识');
    if (req.method === 'GET') return send(await this.use(filesServices.files).uploads.view(id, uploadId));
    if (req.method === 'DELETE') return send(await this.use(filesServices.files).uploads.remove(id, uploadId));
    if (req.method === 'PUT') {
      if (!url.searchParams.has('chunk')) throw new AppError('需要分块索引');
      return send(
        await this.use(filesServices.files).uploads.chunk(id, uploadId, Number(url.searchParams.get('chunk')), req, signal),
      );
    }
    if (req.method === 'POST') {
      const session = await this.use(filesServices.files).uploads.view(id, uploadId);
      return send(await this.use(filesServices.fileLocks).withMutation(id, [session.path], lockToken,
        () => this.use(filesServices.files).uploads.commit(id, uploadId, signal)));
    }
  }
  if (req.method === 'GET' && parts.length === 4 && parts[3] === 'files')
    return send(await this.vm.files(id, guestPath(url.searchParams.get('path') || '/workspace')));
  if (req.method === 'GET' && parts.length === 4 && parts[3] === 'file') {
    const content = await this.vm.readGuestFile(id, guestPath(url.searchParams.get('path')));
    return send({ content, version: textVersion(content) });
  }
  if (req.method === 'PUT' && parts.length === 4 && parts[3] === 'file') {
    const value = httpRouteRequests["files.legacy.put.vms.vmId.file"]
      .parse(await body(req, signal, MAX_TEXT_REQUEST_BYTES));
    if (this.optional(migrationServices.migration)?.blocked) throw new AppError('数据目录迁移维护中', 409);
    await this.use(filesServices.fileLocks).withMutation(id, [guestPath(value.path)], value.lockToken,
      () => this.vm.writeGuestFile(
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
          send(await this.use(filesServices.history).content(id, url.searchParams.get('content')!));
        else send({ items: await this.use(filesServices.history).list(id, url.searchParams.get('path') || undefined) });
        return true;
      }
      if (req.method === 'POST') {
        const input = httpRouteRequests["files.legacy.post.vms.vmId.history"]
          .parse(await body(req, signal));
        if (input.action === 'restore') {
          const entry = (await this.use(filesServices.history).list(id)).find((item) => item.id === input.id);
          if (!entry) throw new AppError('历史记录不存在', 404);
          send(await this.use(filesServices.fileLocks).withMutation(id, [entry.path], input.lockToken,
            () => this.use(filesServices.history).restore(id, input.id, input.expectedVersion)));
        } else send(await this.use(filesServices.history).purge(id, input.id));
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
        send(await this.use(filesServices.fileLocks).withMutation(id, [path], lockToken,
          () => this.use(filesServices.files).upload(id, path, req, url.searchParams.get('overwrite') === '1', signal)));
        return true;
      }
      if (req.method === 'GET') {
        await this.use(transfersServices.downloads).send({ id, type: 'file', path, name: posix.basename(path) }, res);
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'file-operation' && req.method === 'POST') {
      const input = httpRouteRequests["files.legacy.post.vms.vmId.file-operation"]
        .parse(await body(req, signal));
      send(await this.use(filesServices.fileLocks).withMutation(id,
        [input.path, ...(input.destination ? [input.destination] : [])], input.lockToken,
        () => this.use(filesServices.files).operation(id, input.action, input.path, input.destination, input.recursive)));
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.vms.vmId.files": route,
  "legacy.get.vms.vmId.file": route,
  "legacy.put.vms.vmId.file": route,
  "legacy.get.vms.vmId.file-lock": route,
  "legacy.post.vms.vmId.file-lock": route,
  "legacy.get.vms.vmId.history": route,
  "legacy.post.vms.vmId.history": route,
  "legacy.get.vms.vmId.transfer": route,
  "legacy.put.vms.vmId.transfer": route,
  "legacy.post.vms.vmId.file-operation": route,
  "legacy.get.vms.vmId.uploads": route,
  "legacy.post.vms.vmId.uploads": route,
  "legacy.put.vms.vmId.uploads": route,
  "legacy.delete.vms.vmId.uploads": route,
  "legacy.get.vms.vmId.file-preview": route,
  "legacy.get.vms.vmId.download-chunks": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("files");
