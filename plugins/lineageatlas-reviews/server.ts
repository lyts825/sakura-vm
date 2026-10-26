/** 图复核：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {LineageatlasReviews} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {lineageatlasRouteMetadata} from '../../shared/contracts/lineageatlas-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../lineageatlas-spaces/services.ts';
import {services as peer1} from '../lineageatlas-assets/services.ts';
import {services as peer2} from '../lineageatlas-graphs/services.ts';
import {services as peer3} from '../lineageatlas-impacts/services.ts';
import {services as peer4} from '../lineageatlas-investigations/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('lineageatlas-reviews');
export async function activate(host:PluginContext){const service=new LineageatlasReviews('lineageatlas-reviews',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'lineageatlas-spaces':host.use(peer0.domain),'lineageatlas-assets':host.use(peer1.domain),'lineageatlas-graphs':host.use(peer2.domain),'lineageatlas-impacts':host.use(peer3.domain),'lineageatlas-investigations':host.use(peer4.domain)},requiredSeventhComputePort(host.system.optional('lineageGraphCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('lineageatlas-reviews',schemas,services.domain,lineageatlasRouteMetadata['reviews']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
