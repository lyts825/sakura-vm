/** 装配本领域服务；所有修改沿宿主准入及公共契约执行。
 * Compose public services and route owner-scoped requests through the host admission layer. */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { services } from './services.ts';
import { DeliveryRunners } from '../../server/delivery-runners.ts';
import { services as artifactServices } from '../delivery-artifacts/services.ts';
import { services as inputServices } from '../delivery-inputs/services.ts';
import { services as projectServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
/** 借用声明的依赖并注册领域服务；受管资源随插件寿命关闭。
 * Borrow declared dependencies and register services; managed resources follow the plugin lifetime. */
export async function activate(host: PluginContext) {
  const service = new DeliveryRunners(
    host.vm,
    host.use(projectServices.workspaces),
    host.use(artifactServices.artifacts),
    host.use(inputServices.inputs),
    host.capabilities.metadata.reference('runs', () => []),
    deliveryAuthorize(host),
  );
  await service.init();
  host.provide(services.runners, service);
  host.registerJobs(service.jobs, () => {
    throw new Error('请在交付工作台按固定输入创建新一轮运行');
  });
  host.onDispose(() => service.close());
}
/** 校验作用域与动作后转交领域服务；异常沿宿主统一错误协议返回。
 * Validate scope and action before delegating; errors follow the host response protocol. */
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/delivery-runners') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.runners);
  if (req.method === 'GET') {
    sendJson(res, await service.list(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  const input = httpRouteRequests['delivery-runners.act'].parse(await body(req, signal));
  let result;
  if (input.action === 'start') result = await service.start(scope, input.input);
  else result = await service[input.action](scope, input.id);
  sendJson(res, result);
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('delivery-runners');
