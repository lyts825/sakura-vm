/**
 * 模块职责（中文）：“传输基础”插件服务端入口。激活时装配 Downloads，并处理声明的服务端操作。
 * Module responsibility (English): service composition for download tickets, streaming transfers and jobs, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route, httpHandlers, responseContracts；职责覆盖装配下载票据、流式传输与任务的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route, httpHandlers, responseContracts. The scope covers service composition for download tickets, streaming transfers and jobs, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { services as filesServices } from '../files/services.ts';
import { services as snapshotsServices } from '../snapshots/services.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as transfersServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { Downloads, downloadSchema } from '../../server/downloads.ts';
import { retryTarget } from '../../server/plugins/retry.ts';

/**
 * 中文：在本次插件激活中构造 Downloads，发布 transfersServices.downloads 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct Downloads within this activation and publish transfersServices.downloads service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(transfersServices.downloads, new Downloads(m, {
    // 文件与磁盘包能力按请求时获取；下载基础插件独立启用时不会要求这些可选服务已经运行。
    /**
     * 中文：访问时查询可选文件服务，下载票据与流读取按当时可用依赖执行。
     * English: Resolve optional file service on access so download tickets/stream reads use currently available dependencies.
     */
    get files() {
      return host.optional(filesServices.files);
    },
    /**
     * 中文：访问时查询可选签名包服务，不缓存可能在运行中被撤销的依赖引用。
     * English: Resolve optional signed-bundle service on access without retaining references that may be revoked at runtime.
     */
    get bundles() {
      return host.optional(snapshotsServices.bundles);
    },
  }));
  host.registerJobs(host.use(transfersServices.downloads).jobs, async (job) => {
    host.require('snapshots');
    return host.use(transfersServices.downloads).issue(retryTarget(job), { type: 'export' });
  });
}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 downloadSchema 等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including downloadSchema. Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
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
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'download' && req.method === 'POST') {
      const input = downloadSchema.parse(await body(req, signal));
      this.require(input.type === 'export' ? 'snapshots' : 'files');
      send(await this.use(transfersServices.downloads).issue(id, input), 201);
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.post.vms.vmId.download": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("transfers");
