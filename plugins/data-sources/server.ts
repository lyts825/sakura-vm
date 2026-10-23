/** 装配数据能力，所有读写经过宿主准入。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { dataHttpAct } from '../../server/data-http.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { AppError } from '../../shared/errors.ts';
import { services } from './services.ts';
import { DataSources } from '../../server/data-sources.ts';
import { services as secrets } from '../secrets/services.ts';
export { manifest } from './manifest.ts';
import { services as projects } from '../projects/services.ts';
import { services as artifacts } from '../delivery-artifacts/services.ts';
export async function activate(host: PluginContext) {
  const authorize = deliveryAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const service = new DataSources(
    meta('sources'),
    host.use(artifacts.artifacts),
    host.vm,
    host.use(projects.workspaces),
    host.optional(secrets.secrets),
    authorize,
  );
  host.provide(services.sources, service);
  host.onDispose(() => service.close());
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/data-sources') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.sources);
  if (req.method === 'GET') {
    sendJson(res, await service.view(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  sendJson(res, await dataHttpAct(this, 'data-sources', scope, service, await body(req, signal), signal));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('data-sources');
