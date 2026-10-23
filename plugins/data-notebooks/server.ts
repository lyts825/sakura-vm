/** 装配数据能力，所有读写经过宿主准入。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { dataHttpAct } from '../../server/data-http.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { AppError } from '../../shared/errors.ts';
import { services } from './services.ts';
import { DataNotebooks } from '../../server/data-notebooks.ts';
export { manifest } from './manifest.ts';
import { services as runtime } from '../data-runtime/services.ts';
import { services as datasets } from '../data-datasets/services.ts';
import { services as artifacts } from '../delivery-artifacts/services.ts';
import { services as projects } from '../projects/services.ts';
export async function activate(host: PluginContext) {
  const authorize = deliveryAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const images = host.system.optional('imageAssets');
  if (!images) throw new AppError('镜像资源端口不可用', 503);
  const service = new DataNotebooks(
    meta('notebooks'),
    meta('evidence'),
    meta('sessions'),
    host.use(artifacts.artifacts),
    host.use(runtime.runtime),
    host.use(datasets.datasets),
    images,
    host.vm,
    host.use(projects.workspaces),
    () => {
      const value = host.system.optional('notebookEnvironmentsV2');
      if (!value) throw new AppError('Notebook 服务尚未就绪', 503);
      return value;
    },
    authorize,
  );
  await service.init();
  host.provide(services.notebooks, service);
  host.onDispose(() => service.close());
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/data-notebooks') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.notebooks);
  if (req.method === 'GET') {
    sendJson(res, await service.view(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  sendJson(res, await dataHttpAct(this, 'data-notebooks', scope, service, await body(req, signal), signal));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('data-notebooks');
