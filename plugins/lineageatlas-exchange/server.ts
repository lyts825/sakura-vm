/** 血缘交接：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {LineageatlasExchange} from '../../server/seventh-domains.generated.ts';
import {SeventhComputePort} from '../../server/seventh-compute.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {lineageatlasRouteMetadata} from '../../shared/contracts/lineageatlas-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../lineageatlas-spaces/services.ts';
import {services as peer1} from '../lineageatlas-catalogs/services.ts';
import {services as peer2} from '../lineageatlas-assets/services.ts';
import {services as peer3} from '../lineageatlas-mappings/services.ts';
import {services as peer4} from '../lineageatlas-processes/services.ts';
import {services as peer5} from '../lineageatlas-assertions/services.ts';
import {services as peer6} from '../lineageatlas-graphs/services.ts';
import {services as peer7} from '../lineageatlas-impacts/services.ts';
import {services as peer8} from '../lineageatlas-investigations/services.ts';
import {services as peer9} from '../lineageatlas-reviews/services.ts';
import {services as peer10} from '../lineageatlas-reports/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('lineageatlas-exchange');
export async function activate(host:PluginContext){const service=new LineageatlasExchange('lineage-atlas',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('blobs',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'lineageatlas-spaces':host.use(peer0.domain),'lineageatlas-catalogs':host.use(peer1.domain),'lineageatlas-assets':host.use(peer2.domain),'lineageatlas-mappings':host.use(peer3.domain),'lineageatlas-processes':host.use(peer4.domain),'lineageatlas-assertions':host.use(peer5.domain),'lineageatlas-graphs':host.use(peer6.domain),'lineageatlas-impacts':host.use(peer7.domain),'lineageatlas-investigations':host.use(peer8.domain),'lineageatlas-reviews':host.use(peer9.domain),'lineageatlas-reports':host.use(peer10.domain)},{'lineageatlas-catalogs':host.use(peer1.domain)});host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.close());}
export const route=suiteRoute('lineageatlas-exchange',schemas,services.domain,lineageatlasRouteMetadata['exchange']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
