/** 装配数据能力，所有读写经过宿主准入。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { dataHttpAct } from '../../server/data-http.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { deliveryHttpScope, deliveryAuthorize } from '../../server/delivery-http.ts';
import { AppError } from '../../shared/errors.ts';
import { services } from './services.ts';
import { DataRuntime } from '../../server/data-runtime.ts';
export { manifest } from './manifest.ts';
import { services as projects } from '../projects/services.ts';
import { services as artifacts } from '../delivery-artifacts/services.ts';
export async function activate(host: PluginContext) {
  const authorize = deliveryAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const images = host.system.optional('imageAssets');
  if (!images) throw new AppError('镜像资源端口不可用', 503);
  const service = new DataRuntime(
    host.vm,
    host.use(projects.workspaces),
    host.use(artifacts.artifacts),
    images,
    meta('runs'),
    meta('environments'),
    authorize,
    meta('preparations'),
  );
  await service.init();
  host.provide(services.runtime, service);
  host.registerJobs(service.jobs, () => {
    throw new Error('请按固定输入创建新的数据运行');
  });
  host.onDispose(() => service.close());
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/data-runtime') return false;
  const scope = deliveryHttpScope(url),
    service = this.use(services.runtime);
  if (req.method === 'GET') {
    sendJson(res, await service.view(scope));
    return true;
  }
  if (req.method !== 'POST') return false;
  sendJson(res, await dataHttpAct(this, 'data-runtime', scope, service, await body(req, signal), signal));
  return true;
};
export const httpHandlers: Record<string, PluginRoute> = { view: route, act: route };
export const responseContracts = pluginResponseContracts('data-runtime');
