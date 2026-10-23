/** 装配本领域服务；所有修改沿宿主准入及公共契约执行。
 * Compose public services and route owner-scoped requests through the host admission layer. */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { services } from './services.ts';
import { DeliveryArtifacts } from '../../server/delivery-artifacts.ts';
export { manifest } from './manifest.ts';
/** 借用声明的依赖并注册领域服务；受管资源随插件寿命关闭。
 * Borrow declared dependencies and register services; managed resources follow the plugin lifetime. */
export async function activate(host: PluginContext) {
  const service = new DeliveryArtifacts(
    host.capabilities.metadata.reference('index', () => null),
    deliveryAuthorize(host),
  );
  host.provide(services.artifacts, service);
  host.onDispose(() => service.close());
}
/** 校验作用域与动作后转交领域服务；异常沿宿主统一错误协议返回。
 * Validate scope and action before delegating; errors follow the host response protocol. */
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/delivery-artifacts') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.artifacts);
  if (req.method === 'GET') {
    sendJson(res, await service.list(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  const input = httpRouteRequests['delivery-artifacts.act'].parse(await body(req, signal));
  let result;
  if (input.action === 'begin')
    result = await service.begin(scope, { sha256: input.sha256, bytes: input.bytes });
  else if (input.action === 'chunk') result = await service.chunk(scope, input.id, input.offset, input.data);
  else if (input.action === 'complete') result = await service.complete(scope, input.id);
  else if (input.action === 'open-read') result = await service.openRead(scope, input.id);
  else if (input.action === 'close-read') result = await service.closeRead(scope, input.token);
  else if (input.action === 'read')
    result = await service.read(scope, input.blobId, input.offset, input.length);
  else if (input.action === 'seal')
    result = await service.seal(scope, { label: input.label, kind: input.kind, files: input.files });
  else if (input.action === 'verify') result = await service.verify(scope, input.id);
  else if (input.action === 'cleanup-plan') result = await service.cleanupPlan(scope);
  else result = await service.cleanup(scope, input.token);
  sendJson(res, result);
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('delivery-artifacts');
