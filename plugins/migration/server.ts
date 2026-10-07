/**
 * 模块职责（中文）：“数据目录迁移”插件服务端入口。激活时装配 DataMigration，并处理声明的服务端操作。
 * Module responsibility (English): service composition for host data-directory migration, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route, httpHandlers, responseContracts；职责覆盖装配主机数据目录迁移的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route, httpHandlers, responseContracts. The scope covers service composition for host data-directory migration, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as migrationServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { AppError } from '../../shared/errors.ts';

import { DataMigration } from '../../server/data-migration.ts';

/**
 * 中文：在本次插件激活中构造 DataMigration，发布 migrationServices.migration 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct DataMigration within this activation and publish migrationServices.migration service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(migrationServices.migration, new DataMigration(m, () =>
    host.jobSources(),
  ));
}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 httpRouteRequests["migration.legacy.post.migration"]
         等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including httpRouteRequests["migration.legacy.post.migration"]
        . Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：请等待正在执行的请求完成。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 请等待正在执行的请求完成. These errors reach the direct caller or this function's catch handler
 */
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: /** 中文：异步读取请求正文供路由 Schema 校验，不预先假设输入类型；这是 route 的调用契约 | English: Asynchronously read request data for route-schema validation without assuming an input type; this is the callable contract of route | 中文：输入：req：签名所示 IncomingMessage 业务值；signal：本次调用的取消寿命 | English: Inputs: req: the IncomingMessage domain value in the signature; signal: cancellation lifetime for this invocation | 中文：结果：Promise<any>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<any>; callers depend on this type contract, with promise rejection representing asynchronous failure */ (req: IncomingMessage, signal?: AbortSignal) => Promise<any>,
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
  if (parts[1] === 'migration' && parts.length === 2) {
    if (req.method === 'GET') {
      send(await this.use(migrationServices.migration).view());
      return true;
    }
    if (req.method === 'POST') {
      const input = httpRouteRequests["migration.legacy.post.migration"]
        .parse(await body(req, signal));
      if (input.action === 'cancel-activation') send(await this.use(migrationServices.migration).cancelActivation());
      else if (input.action === 'preview') {
        const { files: _files, ...plan } = await this.use(migrationServices.migration).plan(input.target || '');
        send(plan);
      } else {
        if (this.activity.mutations || this.activity.importing) throw new AppError('请等待正在执行的请求完成', 409);
        send(await this.use(migrationServices.migration).start(input.target || '', input.token || ''), 202);
      }
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.migration": route,
  "legacy.post.migration": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("migration");
