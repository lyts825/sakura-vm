/**
 * 模块职责（中文）：“文件工作台”插件服务端入口。激活时装配 Files、FileHistory、FileLocks，并处理声明的服务端操作。
 * Module responsibility (English): service composition for files, editing, history and uploads/downloads, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route, httpHandlers, responseContracts；职责覆盖装配文件、编辑、历史和上传下载的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route, httpHandlers, responseContracts. The scope covers service composition for files, editing, history and uploads/downloads, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
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
import { FilesCapture } from '../../server/files-capture.ts';
import { services as projectCaptureServices } from '../projects/services.ts';

/**
 * 中文：在本次插件激活中构造 Files、FileHistory、FileLocks，发布 filesServices.files、filesServices.history、filesServices.fileLocks 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct Files, FileHistory, FileLocks within this activation and publish filesServices.files, filesServices.history, filesServices.fileLocks service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const m = host.vm;
  const capture = new FilesCapture(m, host.optional(projectCaptureServices.workspaces));
  host.provide(filesServices.capture, capture);
  host.onDispose(() => capture.close());
  const files = host.provide(filesServices.files, new Files(m));
  const history = host.provide(filesServices.history, new FileHistory(m, files));
  const locks = host.provide(filesServices.fileLocks, new FileLocks());
  const unregister = m.beforeFileReplace((id, path, ftp, signal) => history.capture(id, path, ftp, signal));
  /**
   * 中文：把文件删除请求交给历史服务的 trash，保留递归选择与历史恢复路径，而非直接从入口删除内容。
   * English: Delegate file deletion to history trash, retaining recursive choice/recovery history rather than deleting content directly at the entry point.
   * 中文：输入：id：目标资源标识；path：目标文件或请求路径；recursive：此处理器的调用值
   * English: Inputs: id: target resource identifier; path: target file/request path; recursive: the invocation value for this handler
   */
  files.trash = (id, path, recursive) => history.trash(id, path, recursive);
  // 文件历史钩子与 trash 替换属于本次激活；关闭时撤销并清空租约，防止旧插件实例继续拦截写入。
  host.onDispose(/** 中文：更新 files.trash 以维护装配文件、编辑、历史和上传下载的服务，发布清单中声明的操作并随插件关闭清理当前状态；这些赋值属于此输入/事件的状态转换 | English: Update files.trash to maintain current state for service composition for files, editing, history and uploads/downloads, publication of declared operations and lifecycle cleanup; these assignments belong to this input/event transition | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => { unregister(); locks.clear(); files.trash = undefined; });
}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 httpRouteRequests["files.legacy.post.vms.vmId.file-lock"]、httpRouteRequests["files.legacy.put.vms.vmId.file"]
      、httpRouteRequests["files.legacy.post.vms.vmId.history"]
          、httpRouteRequests["files.legacy.post.vms.vmId.file-operation"]
         等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including httpRouteRequests["files.legacy.post.vms.vmId.file-lock"], httpRouteRequests["files.legacy.put.vms.vmId.file"]
      , httpRouteRequests["files.legacy.post.vms.vmId.history"]
          , httpRouteRequests["files.legacy.post.vms.vmId.file-operation"]
        . Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：数据目录迁移维护中；获取文件锁时不能提供旧令牌；需要文件锁令牌；文件锁令牌无效；需要上传会话标识；需要分块索引；历史记录不存在。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 数据目录迁移维护中; 获取文件锁时不能提供旧令牌; 需要文件锁令牌; 文件锁令牌无效; 需要上传会话标识; 需要分块索引; 历史记录不存在. These errors reach the direct caller or this function's catch handler
 */
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: /** 中文：异步读取请求正文供路由 Schema 校验，不预先假设输入类型；这是 route 的调用契约 | English: Asynchronously read request data for route-schema validation without assuming an input type; this is the callable contract of route | 中文：输入：req：签名所示 IncomingMessage 业务值；signal：本次调用的取消寿命；limit：资源或条目数量上限 | English: Inputs: req: the IncomingMessage domain value in the signature; signal: cancellation lifetime for this invocation; limit: resource/entry count limit | 中文：结果：Promise<any>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<any>; callers depend on this type contract, with promise rejection representing asynchronous failure */ (req: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  /**
   * 中文：把服务结果按当前操作响应描述写入 HTTP 输出，并返回 true 标记本路由已认领请求
   * English: Write service results through the current operation response description and return true to mark the request claimed
   * 中文：输入：data：签名所示 unknown 业务值；status：此处理器的调用值（缺省 200）
   * English: Inputs: data: the unknown domain value in the signature; status: the invocation value for this handler (default 200)
   */
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
