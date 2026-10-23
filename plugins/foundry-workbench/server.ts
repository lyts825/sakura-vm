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
import { services as depotServices } from '../foundry-depot/services.ts';
import { services as buildersServices } from '../foundry-builders/services.ts';
import { services as sanitizersServices } from '../foundry-sanitizers/services.ts';
import { services as checksServices } from '../foundry-checks/services.ts';
import { services as catalogServices } from '../foundry-catalog/services.ts';
import { services as exchangeServices } from '../foundry-exchange/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const assets = host.system.optional('imageAssets');
  if (!assets) throw new Error('镜像资产服务尚未就绪');
  const service = new Foundry(
    'workbench',
    host.capabilities.metadata.reference('index', () => null),
    host.vm,
    assets,
    [
      host.use(sourcesServices.foundrySources),
      host.use(blueprintsServices.foundryBlueprints),
      host.use(depotServices.foundryDepot),
      host.use(buildersServices.foundryBuilders),
      host.use(sanitizersServices.foundrySanitizers),
      host.use(checksServices.foundryChecks),
      host.use(catalogServices.foundryCatalog),
      host.use(exchangeServices.foundryExchange),
    ],
    async (scope) => {
      foundryScopeSchema.parse(scope);
      host.signal.throwIfAborted();
      await captureOperationCheck()();
    },
  );
  host.provide(services.foundryWorkbench, service);
  host.registerJobs(service.jobs, () => {
    throw new Error('请重新审阅计划后创建新尝试');
  });
  host.onDispose(() => service.close());
}
export const route: PluginRoute = async function (req, res, url, body, signal) {
  if (url.pathname !== '/api/foundry-workbench') return false;
  const scope = foundryScopeSchema.parse({ workspaceId: url.searchParams.get('workspaceId') });
  const service = this.use(services.foundryWorkbench);
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
