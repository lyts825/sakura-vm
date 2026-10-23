/** 装配数据能力，所有读写经过宿主准入。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { dataHttpAct } from '../../server/data-http.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { AppError } from '../../shared/errors.ts';
import { services } from './services.ts';
import { DataLineage } from '../../server/data-lineage.ts';
export { manifest } from './manifest.ts';
import { services as datasets } from '../data-datasets/services.ts';
import { services as transforms } from '../data-transforms/services.ts';
import { services as quality } from '../data-quality/services.ts';
import { services as notebooks } from '../data-notebooks/services.ts';
import { services as runtime } from '../data-runtime/services.ts';
export async function activate(host: PluginContext) {
  const authorize = deliveryAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const service = new DataLineage(
    host.use(datasets.datasets),
    host.use(transforms.transforms),
    host.use(quality.quality),
    host.use(notebooks.notebooks),
    host.use(runtime.runtime),
    authorize,
  );
  host.provide(services.lineage, service);
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/data-lineage') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.lineage);
  if (req.method === 'GET') {
    sendJson(res, await service.view(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  sendJson(res, await dataHttpAct(this, 'data-lineage', scope, service, await body(req, signal), signal));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('data-lineage');
