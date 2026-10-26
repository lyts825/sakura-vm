/** 资产身份：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {LineageatlasAssets} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {lineageatlasRouteMetadata} from '../../shared/contracts/lineageatlas-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../lineageatlas-spaces/services.ts';
import {services as peer1} from '../lineageatlas-catalogs/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('lineageatlas-assets');
export async function activate(host:PluginContext){const service=new LineageatlasAssets('lineageatlas-assets',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'lineageatlas-spaces':host.use(peer0.domain),'lineageatlas-catalogs':host.use(peer1.domain)},requiredSeventhComputePort(host.system.optional('lineageGraphCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('lineageatlas-assets',schemas,services.domain,lineageatlasRouteMetadata['assets']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
