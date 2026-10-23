/** 装配独立领域服务并通过严格契约处理请求。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { appIdSchema } from '../../shared/contracts/app-runtime.ts';
import { appAuthorize } from '../../server/app-http.ts';
import { AppRecovery } from '../../server/app-recovery.ts';
import { services } from './services.ts';
import { services as targetServices } from '../app-targets/services.ts';
import { services as projectServices } from '../projects/services.ts';
import { services as backupServices } from '../backups/services.ts';
import { services as routeServices } from '../app-routes/services.ts';
import { services as dataServices } from '../app-data/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = appAuthorize(host);
  const metadata = (name: string) =>
    host.capabilities.metadata.reference(name, () => ({ schemaVersion: 1, rows: [] }));
  const service = new AppRecovery(
    metadata('checkpoints'),
    host.vm,
    host.use(targetServices.appTargets),
    host.use(projectServices.workspaces),
    host.use(backupServices.backups),
    host.use(routeServices.appRoutes),
    authorize,
    host.use(dataServices.appData),
    metadata('policies'),
  );
  await service.init();
  host.provide(services.appRecovery, service);
  host.onDispose(() => service.close());
  host.registerJobs(service.jobs, () => {
    throw new Error('请核销原操作后生成新计划');
  });
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/app-recovery') return false;
  const appId = url.searchParams.get('appId') || undefined;
  if (appId) appIdSchema.parse(appId);
  const service = this.use(services.appRecovery);
  if (req.method === 'GET') {
    sendJson(res, await service.view(appId));
    return true;
  }
  if (req.method !== 'POST') return false;
  const input = httpRouteRequests['app-recovery.act'].parse(await body(req, signal));
  sendJson(res, await service.act(appIdSchema.parse(appId), input));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('app-recovery');
