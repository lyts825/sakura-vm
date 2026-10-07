/**
 * 模块职责：“服务健康检查”插件服务端入口。激活时装配 ServiceHealth，并处理声明的服务端操作。
 */
import { services as projectsServices } from '../projects/services.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as serviceHealthServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { ServiceHealth } from '../../server/service-health.ts';
export async function activate(host: PluginContext) {
  const health = host.provide(serviceHealthServices.health,
    new ServiceHealth(host.vm, host.use(projectsServices.workspaces), { deferInitialization: true }));
  // 先发布健康检查服务再初始化定时工作，让宿主在激活失败或插件关闭时仍能管理服务资源。
  health.init();
}
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: Parameters<PluginRoute>[3],
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);

  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'health' && req.method === 'GET') {
      send(await this.use(serviceHealthServices.health).view(id));
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.vms.vmId.health": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("service-health");
