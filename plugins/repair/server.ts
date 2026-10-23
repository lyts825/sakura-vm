/** 装配修复能力并按明确输入/输出 Schema 发布路由。 Compose repair capabilities and publish schema-checked routes. */
import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';
import { RepairSessions } from '../../server/repair-sessions.ts';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { services } from './services.ts';
import { services as projectServices } from '../projects/services.ts';
import { services as sandboxServices } from '../sandbox/services.ts';
import { services as fileServices } from '../files/services.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
export { manifest } from './manifest.ts';

/** 仅连接已启用的服务，关闭时释放本插件的在途会话。 Bind enabled services and release this plugin's sessions on shutdown. */
export async function activate(host: PluginContext) {
  /** 请求使用模型时才解析本体服务，降级状态仍保留可见入口。 Resolve the host model service on use so degraded availability keeps the UI visible. */
  const assistant = () => {
    const service = host.system.optional('assistant');
    if (!service) throw new AppError('本地助手服务不可用，请先修复本地模型设置', 503);
    return service;
  };
  const repair = new RepairSessions(host.vm, host.use(projectServices.workspaces), assistant,
    host.use(sandboxServices.sandboxes), host.use(fileServices.fileLocks));
  host.provide(services.repair, repair);
  host.onDispose(() => repair.close());
}

/** 分派受控操作，发送模型和接受补丁始终由独立请求触发。 Dispatch explicit actions; sending and applying require separate requests. */
export const route: PluginRoute = async function (req, res, url, body, signal) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 4 || parts[1] !== 'vms' || parts[3] !== 'repair') return false;
  const id = parts[2], repair = this.use(services.repair);
  if (req.method === 'GET') {
    sendJson(res, repair.view(id, z.uuid().parse(url.searchParams.get('sessionId')))); return true;
  }
  if (req.method !== 'POST') return false;
  const input = httpRouteRequests['repair.act'].parse(await body(req, signal));
  if (input.action === 'preview') sendJson(res, await repair.preview(id, input.input, signal));
  else if (input.action === 'validate') sendJson(res, await repair.validate(id, input.input, signal));
  else if (input.action === 'cancel') sendJson(res, await repair.cancel(id, input.sessionId));
  else sendJson(res, await repair[input.action](id, input.sessionId, signal));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('repair');
