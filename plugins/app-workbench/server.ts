/** 装配独立领域服务并通过严格契约处理请求。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { appIdSchema } from '../../shared/contracts/app-runtime.ts';
import { appAuthorize } from '../../server/app-http.ts';
import { AppWorkbench } from '../../server/app-workbench.ts';
import { services } from './services.ts';
import { services as targetsServices } from '../app-targets/services.ts';
import { services as packagesServices } from '../app-packages/services.ts';
import { services as configServices } from '../app-config/services.ts';
import { services as dataServices } from '../app-data/services.ts';
import { services as observeServices } from '../app-observe/services.ts';
import { services as routesServices } from '../app-routes/services.ts';
import { services as recoveryServices } from '../app-recovery/services.ts';
import { services as deployServices } from '../app-deploy/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = appAuthorize(host);
  const metadata = (name: string) =>
    host.capabilities.metadata.reference(name, () => ({ schemaVersion: 1, rows: [] }));
  const service = new AppWorkbench([
    host.use(targetsServices.appTargets),
    host.use(packagesServices.appPackages),
    host.use(configServices.appConfig),
    host.use(dataServices.appData),
    host.use(observeServices.appObserve),
    host.use(routesServices.appRoutes),
    host.use(recoveryServices.appRecovery),
    host.use(deployServices.appDeploy),
  ]);
  host.provide(services.appWorkbench, service);
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/app-workbench') return false;
  const appId = url.searchParams.get('appId') || undefined;
  if (appId) appIdSchema.parse(appId);
  const service = this.use(services.appWorkbench);
  if (req.method === 'GET') {
    sendJson(res, await service.view(appId));
    return true;
  }
  if (req.method !== 'POST') return false;
  const input = httpRouteRequests['app-workbench.act'].parse(await body(req, signal));
  sendJson(res, await service.act(appIdSchema.parse(appId), input));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('app-workbench');
