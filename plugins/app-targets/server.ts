/** 装配独立领域服务并通过严格契约处理请求。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { appIdSchema } from '../../shared/contracts/app-runtime.ts';
import { appAuthorize } from '../../server/app-http.ts';
import { AppTargets } from '../../server/app-targets.ts';
import { services } from './services.ts';
import { services as projectServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = appAuthorize(host);
  const metadata = (name: string) =>
    host.capabilities.metadata.reference(name, () => ({ schemaVersion: 1, rows: [] }));
  const service = new AppTargets(
    host.vm,
    host.use(projectServices.workspaces),
    metadata('targets'),
    authorize,
    host.system.optional('imageAssets'),
    host.system.optional('egressRules'),
  );
  host.provide(services.appTargets, service);
  host.onDispose(() => service.close());
  host.registerJobs(service.jobs, () => {
    throw new Error('请核销原操作后生成新计划');
  });
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/app-targets') return false;
  const appId = url.searchParams.get('appId') || undefined;
  if (appId) appIdSchema.parse(appId);
  const service = this.use(services.appTargets);
  if (req.method === 'GET') {
    sendJson(res, await service.view(appId));
    return true;
  }
  if (req.method !== 'POST') return false;
  const input = httpRouteRequests['app-targets.act'].parse(await body(req, signal));
  sendJson(res, await service.act(appIdSchema.parse(appId), input));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('app-targets');
