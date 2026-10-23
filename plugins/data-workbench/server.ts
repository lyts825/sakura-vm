/** 装配数据能力，所有读写经过宿主准入。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { dataHttpAct } from '../../server/data-http.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { AppError } from '../../shared/errors.ts';
import { services } from './services.ts';
import { DataWorkbench } from '../../server/data-workbench.ts';
export { manifest } from './manifest.ts';
import { services as runtime } from '../data-runtime/services.ts';
import { services as sources } from '../data-sources/services.ts';
import { services as datasets } from '../data-datasets/services.ts';
import { services as transforms } from '../data-transforms/services.ts';
import { services as quality } from '../data-quality/services.ts';
import { services as notebooks } from '../data-notebooks/services.ts';
import { services as experiments } from '../data-experiments/services.ts';
import { services as lineage } from '../data-lineage/services.ts';
import { services as exchange } from '../data-exchange/services.ts';
import { services as artifacts } from '../delivery-artifacts/services.ts';
export async function activate(host: PluginContext) {
  const authorize = deliveryAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const service = new DataWorkbench({
    runtime: host.use(runtime.runtime),
    sources: host.use(sources.sources),
    datasets: host.use(datasets.datasets),
    transforms: host.use(transforms.transforms),
    quality: host.use(quality.quality),
    notebooks: host.use(notebooks.notebooks),
    experiments: host.use(experiments.experiments),
    lineage: host.use(lineage.lineage),
    exchange: host.use(exchange.exchange),
  });
  host.provide(services.workbench, service);
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/data-workbench') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.workbench);
  if (req.method === 'GET') {
    sendJson(res, await service.view(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  sendJson(res, await dataHttpAct(this, 'data-workbench', scope, service, await body(req, signal), signal));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('data-workbench');
