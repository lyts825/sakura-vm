/** 装配数据能力，所有读写经过宿主准入。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { dataHttpAct } from '../../server/data-http.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { AppError } from '../../shared/errors.ts';
import { services } from './services.ts';
import { DataExchange } from '../../server/data-exchange.ts';
import { services as runtime } from '../data-runtime/services.ts';
import { services as lineage } from '../data-lineage/services.ts';
export { manifest } from './manifest.ts';
import { services as datasets } from '../data-datasets/services.ts';
import { services as artifacts } from '../delivery-artifacts/services.ts';
export async function activate(host: PluginContext) {
  const authorize = deliveryAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const service = new DataExchange(
    meta('imports'),
    host.use(artifacts.artifacts),
    host.use(datasets.datasets),
    authorize,
    () => {
      const r = host.optional(runtime.runtime),
        l = host.optional(lineage.lineage);
      return r && l ? { runtime: r, lineage: l } : undefined;
    },
  );
  host.provide(services.exchange, service);
  host.onDispose(() => service.close());
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/data-exchange') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.exchange);
  if (req.method === 'GET') {
    sendJson(res, await service.view(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  sendJson(res, await dataHttpAct(this, 'data-exchange', scope, service, await body(req, signal), signal));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('data-exchange');
