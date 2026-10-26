/** 提取空间：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {DextractSpaces} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {dextractRouteMetadata} from '../../shared/contracts/dextract-routes.generated.ts';
import {services} from './services.ts';

export {manifest} from './manifest.ts';
const schemas=seventhSchemas('dextract-spaces');
export async function activate(host:PluginContext){const service=new DextractSpaces('dextract-spaces',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),undefined,{},requiredSeventhComputePort(host.system.optional('documentExtractionSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('dextract-spaces',schemas,services.domain,dextractRouteMetadata['spaces']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
