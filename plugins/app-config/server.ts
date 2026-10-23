/** 装配独立领域服务并通过严格契约处理请求。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { appIdSchema } from '../../shared/contracts/app-runtime.ts';
import { appAuthorize } from '../../server/app-http.ts';
import { AppConfigService } from '../../server/app-config.ts';
import { services } from './services.ts';
import { services as targetServices } from '../app-targets/services.ts';
import { services as secretServices } from '../secrets/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = appAuthorize(host);
  const metadata = (name: string) =>
    host.capabilities.metadata.reference(name, () => ({ schemaVersion: 1, rows: [] }));
  const service = new AppConfigService(
    metadata('configs'),
    host.use(targetServices.appTargets),
    host.use(secretServices.secrets),
    authorize,
  );
  host.provide(services.appConfig, service);
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/app-config') return false;
  const appId = url.searchParams.get('appId') || undefined;
  if (appId) appIdSchema.parse(appId);
  const service = this.use(services.appConfig);
  if (req.method === 'GET') {
    sendJson(res, await service.view(appId));
    return true;
  }
  if (req.method !== 'POST') return false;
  const input = httpRouteRequests['app-config.act'].parse(await body(req, signal));
  sendJson(res, await service.act(appIdSchema.parse(appId), input));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('app-config');
