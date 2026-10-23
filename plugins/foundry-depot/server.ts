/** 装配工坊领域服务，所有资源经宿主公共能力取得。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { sendJson } from '../../server/http-response.ts';
import { captureOperationCheck } from '../../server/operation-context.ts';
import { Foundry } from '../../server/foundry.ts';
import {
  foundryActionSchema,
  foundryScopeSchema,
  foundryViewSchema,
  foundryResultSchema,
} from '../../shared/contracts/foundry.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../foundry-sources/services.ts';
import { services as blueprintsServices } from '../foundry-blueprints/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const assets = host.system.optional('imageAssets');
  if (!assets) throw new Error('镜像资产服务尚未就绪');
  const service = new Foundry(
    'depot',
    host.capabilities.metadata.reference('index', () => null),
    host.vm,
    assets,
    [host.use(sourcesServices.foundrySources), host.use(blueprintsServices.foundryBlueprints)],
    async (scope) => {
      foundryScopeSchema.parse(scope);
      host.signal.throwIfAborted();
      await captureOperationCheck()();
    },
  );
  host.provide(services.foundryDepot, service);
  host.registerJobs(service.jobs, () => {
    throw new Error('请重新审阅计划后创建新尝试');
  });
  host.onDispose(() => service.close());
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/foundry-depot') return false;
  const scope = foundryScopeSchema.parse({ workspaceId: url.searchParams.get('workspaceId') });
  const service = this.use(services.foundryDepot);
  if (req.method === 'GET') {
    sendJson(res, await service.view(scope));
    return true;
  }
  if (req.method === 'POST') {
    sendJson(res, await service.act(scope, foundryActionSchema.parse(await body(req, signal))));
    return true;
  }
  return false;
};
export const httpHandlers = { view: route, act: route };
export const responseContracts = { view: foundryViewSchema, act: foundryResultSchema };
