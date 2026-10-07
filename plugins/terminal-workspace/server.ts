/**
 * 模块职责（中文）：“多终端工作区”插件服务端入口。激活时装配 ProjectCatalog，并处理声明的服务端操作。
 * Module responsibility (English): service composition for terminal tabs, splits and session restoration, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route, httpHandlers, responseContracts；职责覆盖装配终端标签、分屏和会话恢复的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route, httpHandlers, responseContracts. The scope covers service composition for terminal tabs, splits and session restoration, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as terminalWorkspaceServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { ProjectCatalog } from '../../server/project-catalog.ts';

/**
 * 中文：在本次插件激活中构造 ，发布 terminalWorkspaceServices.terminals 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct  within this activation and publish terminalWorkspaceServices.terminals service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  // 终端会话能力由宿主提供，插件只发布其服务引用，不另建一套会话拥有者。
  host.provide(terminalWorkspaceServices.terminals, host.capabilities.sessions.terminals());
}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 httpRouteRequests["terminal-workspace.legacy.post.vms.vmId.terminal-session"]
         等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including httpRouteRequests["terminal-workspace.legacy.post.vms.vmId.terminal-session"]
        . Write operation-described responses; return false for unclaimed requests to the main router
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
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'terminal-session' && req.method === 'POST') {
      const input = httpRouteRequests["terminal-workspace.legacy.post.vms.vmId.terminal-session"]
        .parse(await body(req, signal));
      const projects = this.optional(projectsServices.workspaces)?.projects || new ProjectCatalog(this.vm);
      const projectId = await projects.with(id, url.searchParams.get('project'),
        async () => projects.current(id));
      await this.use(terminalWorkspaceServices.terminals).stop(id, projectId,
        'session' in input ? input.session : undefined, signal);
      send({ ok: true, projectId });
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, PluginRoute> = {
  "legacy.post.vms.vmId.terminal-session": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("terminal-workspace");
