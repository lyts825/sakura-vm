/** 装配数据能力，所有读写经过宿主准入。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { dataHttpAct } from '../../server/data-http.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { AppError } from '../../shared/errors.ts';
import { services } from './services.ts';
import { DataDatasets } from '../../server/data-datasets.ts';
export { manifest } from './manifest.ts';
import { services as runtime } from '../data-runtime/services.ts';
import { services as sources } from '../data-sources/services.ts';
import { services as artifacts } from '../delivery-artifacts/services.ts';
export async function activate(host: PluginContext) {
  const authorize = deliveryAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const service = new DataDatasets(
    meta('datasets'),
    host.use(artifacts.artifacts),
    host.use(runtime.runtime),
    host.use(sources.sources),
    authorize,
  );
  host.provide(services.datasets, service);
  host.onDispose(() => service.close());
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/data-datasets') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.datasets);
  if (req.method === 'GET') {
    sendJson(res, await service.view(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  sendJson(res, await dataHttpAct(this, 'data-datasets', scope, service, await body(req, signal), signal));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('data-datasets');
