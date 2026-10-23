/** 交付领域服务装配与所有者 HTTP 接口。 Compose delivery services and owner-only HTTP routes. */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { DeliveryReleases } from '../../server/delivery-releases.ts';
import { deliverySigner } from '../../server/delivery-signing.ts';
import { services } from './services.ts';
import { services as artifactServices } from '../delivery-artifacts/services.ts';
import { services as inputServices } from '../delivery-inputs/services.ts';
import { services as runnerServices } from '../delivery-runners/services.ts';
import { services as reportServices } from '../delivery-reports/services.ts';
import { services as gateServices } from '../delivery-gates/services.ts';
import { services as previewServices } from '../delivery-previews/services.ts';
import { services as secretServices } from '../secrets/services.ts';
export { manifest } from './manifest.ts';
/** 借用声明的依赖并注册领域服务；受管资源随插件寿命关闭。
 * Borrow declared dependencies and register services; managed resources follow the plugin lifetime. */
export async function activate(host: PluginContext) {
  const service = new DeliveryReleases(
    host.use(artifactServices.artifacts),
    host.use(inputServices.inputs),
    host.use(runnerServices.runners),
    host.use(reportServices.reports),
    host.use(gateServices.gates),
    host.use(previewServices.previews),
    host.capabilities.metadata.reference('index', () => ({})),
    deliveryAuthorize(host),
    deliverySigner(() => host.optional(secretServices.secrets)),
  );
  host.provide(services.releases, service);
}
/** 校验作用域与动作后转交领域服务；异常沿宿主统一错误协议返回。
 * Validate scope and action before delegating; errors follow the host response protocol. */
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/delivery-releases') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.releases);
  if (req.method === 'GET') {
    sendJson(res, await service.view(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  const input = httpRouteRequests['delivery-releases.act'].parse(await body(req, signal));
  let result;
  if (input.action === 'candidate') result = await service.createCandidate(scope, input);
  else if (input.action === 'register') result = await service.register(scope, input);
  else if (input.action === 'channel') result = await service.channel(scope, input);
  else if (input.action === 'status') result = await service.changeStatus(scope, input);
  else if (input.action === 'trust') result = await service.trust(scope, input);
  else if (input.action === 'export') result = await service.export(scope, input);
  else if (input.action === 'import') result = await service.importPackage(scope, input);
  else result = await service.acceptImport(scope, input);
  sendJson(res, result);
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('delivery-releases');
