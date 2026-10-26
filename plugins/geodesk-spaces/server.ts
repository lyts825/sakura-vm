/** 地理空间：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {GeodeskSpaces} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {geodeskRouteMetadata} from '../../shared/contracts/geodesk-routes.generated.ts';
import {services} from './services.ts';

export {manifest} from './manifest.ts';
const schemas=seventhSchemas('geodesk-spaces');
export async function activate(host:PluginContext){const service=new GeodeskSpaces('geodesk-spaces',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),undefined,{},requiredSeventhComputePort(host.system.optional('vectorGeometryCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('geodesk-spaces',schemas,services.domain,geodeskRouteMetadata['spaces']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
