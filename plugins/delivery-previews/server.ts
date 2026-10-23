/** 交付领域服务装配与所有者 HTTP 接口。 Compose delivery services and owner-only HTTP routes. */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { DeliveryPreviews } from '../../server/delivery-previews.ts';
import { services } from './services.ts';
import { services as artifactServices } from '../delivery-artifacts/services.ts';
import { services as projectServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
/** 借用声明的依赖并注册领域服务；受管资源随插件寿命关闭。
 * Borrow declared dependencies and register services; managed resources follow the plugin lifetime. */
export async function activate(host: PluginContext) {
  const service = new DeliveryPreviews(
    host.vm,
    host.use(projectServices.workspaces),
    host.use(artifactServices.artifacts),
    host.capabilities.metadata.reference('previews', () => []),
    deliveryAuthorize(host),
    host.system.optional('imageAssets'),
  );
  await service.init();
  host.provide(services.previews, service);
  host.registerJobs(service.jobs, () => {
    throw new Error('请先核销原预览，再显式启动新预览');
  });
  host.onDispose(() => service.close());
}
/** 校验作用域与动作后转交领域服务；异常沿宿主统一错误协议返回。
 * Validate scope and action before delegating; errors follow the host response protocol. */
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/delivery-previews') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.previews);
  if (req.method === 'GET') {
    sendJson(res, await service.list(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  const input = httpRouteRequests['delivery-previews.act'].parse(await body(req, signal));
  const result =
    input.action === 'start'
      ? await service.start(scope, input)
      : await service[input.action](scope, input.id);
  sendJson(res, result);
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('delivery-previews');
