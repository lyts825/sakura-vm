/** 状态矩阵：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {DsysStates} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {dsysRouteMetadata} from '../../shared/contracts/dsys-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../dsys-spaces/services.ts';
import {services as peer1} from '../dsys-components/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('dsys-states');
export async function activate(host:PluginContext){const service=new DsysStates('dsys-states',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'dsys-spaces':host.use(peer0.domain),'dsys-components':host.use(peer1.domain)},requiredSeventhComputePort(host.system.optional('designSystemCompile')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('dsys-states',schemas,services.domain,dsysRouteMetadata['states']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
