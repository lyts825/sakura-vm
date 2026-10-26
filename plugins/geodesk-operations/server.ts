/** 几何操作：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {GeodeskOperations} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {geodeskRouteMetadata} from '../../shared/contracts/geodesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../geodesk-spaces/services.ts';
import {services as peer1} from '../geodesk-crs/services.ts';
import {services as peer2} from '../geodesk-layers/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('geodesk-operations');
export async function activate(host:PluginContext){const service=new GeodeskOperations('geodesk-operations',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'geodesk-spaces':host.use(peer0.domain),'geodesk-crs':host.use(peer1.domain),'geodesk-layers':host.use(peer2.domain)},requiredSeventhComputePort(host.system.optional('vectorGeometryCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('geodesk-operations',schemas,services.domain,geodeskRouteMetadata['operations']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
