/**
 * 模块职责（中文）：“工程扩展适配器”插件服务端入口。激活时装配 ExtendedFeatures，并处理声明的服务端操作。
 * Module responsibility (English): service composition for engineering extensions and capability checks, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route, httpHandlers, responseContracts；职责覆盖装配工程扩展与能力检查的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route, httpHandlers, responseContracts. The scope covers service composition for engineering extensions and capability checks, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { services as projectsServices } from '../projects/services.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as extensionsServices } from './services.ts';
import { services as ideServices } from '../ide/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { ExtendedFeatures } from '../../server/extended-features.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';

/**
 * 中文：在本次插件激活中构造 ExtendedFeatures，发布 extensionsServices.extended 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct ExtendedFeatures within this activation and publish extensionsServices.extended service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(extensionsServices.extended, new ExtendedFeatures(m, host.use(projectsServices.workspaces), host.system, () => host.optional(ideServices.ide)));
  host.registerJobs(host.use(extensionsServices.extended).jobs, (job) => {
    if (job.action?.startsWith('operation:'))
      throw new AppError('此工程操作包含参数，请回到能力中心重新执行');
    if (!job.action?.startsWith('extended:')) throw new AppError('请回到原功能页面重新执行');
    const featureId = job.action.slice('extended:'.length);
    return retryInProject(host, job, () => Promise.resolve(host.use(extensionsServices.extended).action(
      retryTarget(job), { action: 'run', featureId })));
  });
}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Write operation-described responses; return false for unclaimed requests to the main router
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
  body: Parameters<PluginRoute>[3],
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
  if (parts[1] === 'extended-features' && parts.length === 2 && req.method === 'GET') {
    send(await this.use(extensionsServices.extended).catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'extended-features') {
      if (req.method === 'GET') {
        send(await this.use(extensionsServices.extended).view(id));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.use(extensionsServices.extended).action(id, await body(req, signal), signal), 202);
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.extended-features": route,
  "legacy.get.vms.vmId.extended-features": route,
  "legacy.post.vms.vmId.extended-features": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("extensions");
