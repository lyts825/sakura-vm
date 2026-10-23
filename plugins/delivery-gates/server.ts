/** 装配本领域服务；所有修改沿宿主准入及公共契约执行。
 * Compose public services and route owner-scoped requests through the host admission layer. */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { services } from './services.ts';
import { DeliveryGates } from '../../server/delivery-gates.ts';
import { services as artifactServices } from '../delivery-artifacts/services.ts';
import { services as inputServices } from '../delivery-inputs/services.ts';
import { services as runnerServices } from '../delivery-runners/services.ts';
import { services as reportServices } from '../delivery-reports/services.ts';
import { services as previewServices } from '../delivery-previews/services.ts';
export { manifest } from './manifest.ts';
/** 借用声明的依赖并注册领域服务；受管资源随插件寿命关闭。
 * Borrow declared dependencies and register services; managed resources follow the plugin lifetime. */
export async function activate(host: PluginContext) {
  const service = new DeliveryGates(
    host.use(artifactServices.artifacts),
    host.use(inputServices.inputs),
    host.use(runnerServices.runners),
    host.use(reportServices.reports),
    host.use(previewServices.previews),
    host.capabilities.metadata.reference('index', () => ({})),
    deliveryAuthorize(host),
  );
  host.provide(services.gates, service);
}
/** 校验作用域与动作后转交领域服务；异常沿宿主统一错误协议返回。
 * Validate scope and action before delegating; errors follow the host response protocol. */
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/delivery-gates') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.gates);
  if (req.method === 'GET') {
    sendJson(res, await service.view(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  const input = httpRouteRequests['delivery-gates.act'].parse(await body(req, signal));
  let result;
  if (input.action === 'policy') result = await service.savePolicy(scope, input.input);
  else result = await service.evaluate(scope, input.input);
  sendJson(res, result);
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('delivery-gates');
