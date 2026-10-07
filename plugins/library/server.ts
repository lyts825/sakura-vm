/**
 * 模块职责（中文）：“实例整理”插件服务端入口。激活时装配 Set，并处理声明的服务端操作。
 * Module responsibility (English): service composition for VM grouping, tags and batch operations, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route, httpHandlers, responseContracts；职责覆盖装配实例分组、标签与批量操作的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route, httpHandlers, responseContracts. The scope covers service composition for VM grouping, tags and batch operations, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { publicApiFailure } from '../../server/api-errors.ts';

export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

/**
 * 中文：该插件仅贡献清单或界面，空激活满足宿主协议，不创建后台服务
 * English: This plugin contributes manifests/UI; empty activation satisfies the host protocol without creating background services
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 httpRouteRequests["library.legacy.post.vms.batch"]
       等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including httpRouteRequests["library.legacy.post.vms.batch"]
      . Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作
 * English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step
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
  if (parts[1] === 'vms' && parts[2] === 'batch' && parts.length === 3 && req.method === 'POST') {
    const { ids, action } = httpRouteRequests["library.legacy.post.vms.batch"]
      .parse(await body(req, signal));
    const results = [];
    for (const id of new Set(ids)) {
      signal.throwIfAborted();
      try {
        await this.vm[action](id);
        results.push({ id, ok: true });
      } catch (error) {
        const correlationId = res.getHeader?.('X-Sakura-Correlation-Id');
        const { dto } = publicApiFailure(error, typeof correlationId === 'string' ? correlationId : '');
        results.push({ id, ok: false, error: dto.error + (dto.correlationId ? `（关联 ID：${dto.correlationId}）` : '') });
      }
    }
    send({ results });
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'organization' && req.method === 'PUT') {
      send(await this.vm.organize(id, await body(req, signal)));
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.post.vms.batch": route,
  "legacy.put.vms.vmId.organization": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("library");
