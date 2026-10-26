/** 算法档案：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {GraphdeskAlgorithms} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {graphdeskRouteMetadata} from '../../shared/contracts/graphdesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../graphdesk-spaces/services.ts';
import {services as peer1} from '../graphdesk-projections/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('graphdesk-algorithms');
export async function activate(host:PluginContext){const service=new GraphdeskAlgorithms('graphdesk-algorithms',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'graphdesk-spaces':host.use(peer0.domain),'graphdesk-projections':host.use(peer1.domain)},requiredSeventhComputePort(host.system.optional('relationGraphCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('graphdesk-algorithms',schemas,services.domain,graphdeskRouteMetadata['algorithms']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
