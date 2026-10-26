/** 合并约束：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {EntitydeskConstraints} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {entitydeskRouteMetadata} from '../../shared/contracts/entitydesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../entitydesk-spaces/services.ts';
import {services as peer1} from '../entitydesk-sources/services.ts';
import {services as peer2} from '../entitydesk-candidates/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('entitydesk-constraints');
export async function activate(host:PluginContext){const service=new EntitydeskConstraints('entitydesk-constraints',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'entitydesk-spaces':host.use(peer0.domain),'entitydesk-sources':host.use(peer1.domain),'entitydesk-candidates':host.use(peer2.domain)},requiredSeventhComputePort(host.system.optional('entityMatchingCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('entitydesk-constraints',schemas,services.domain,entitydeskRouteMetadata['constraints']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
