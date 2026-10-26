/** 血缘空间：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {LineageatlasSpaces} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {lineageatlasRouteMetadata} from '../../shared/contracts/lineageatlas-routes.generated.ts';
import {services} from './services.ts';

export {manifest} from './manifest.ts';
const schemas=seventhSchemas('lineageatlas-spaces');
export async function activate(host:PluginContext){const service=new LineageatlasSpaces('lineageatlas-spaces',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),undefined,{},requiredSeventhComputePort(host.system.optional('lineageGraphCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('lineageatlas-spaces',schemas,services.domain,lineageatlasRouteMetadata['spaces']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
