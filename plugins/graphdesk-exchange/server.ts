/** 关系图交接：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {GraphdeskExchange} from '../../server/seventh-domains.generated.ts';
import {SeventhComputePort} from '../../server/seventh-compute.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {graphdeskRouteMetadata} from '../../shared/contracts/graphdesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../graphdesk-spaces/services.ts';
import {services as peer1} from '../graphdesk-sources/services.ts';
import {services as peer2} from '../graphdesk-entities/services.ts';
import {services as peer3} from '../graphdesk-edges/services.ts';
import {services as peer4} from '../graphdesk-projections/services.ts';
import {services as peer5} from '../graphdesk-queries/services.ts';
import {services as peer6} from '../graphdesk-algorithms/services.ts';
import {services as peer7} from '../graphdesk-runs/services.ts';
import {services as peer8} from '../graphdesk-comparisons/services.ts';
import {services as peer9} from '../graphdesk-annotations/services.ts';
import {services as peer10} from '../graphdesk-views/services.ts';
import {services as peer11} from '../graphdesk-reports/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('graphdesk-exchange');
export async function activate(host:PluginContext){const service=new GraphdeskExchange('graph-insight-studio',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('blobs',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'graphdesk-spaces':host.use(peer0.domain),'graphdesk-sources':host.use(peer1.domain),'graphdesk-entities':host.use(peer2.domain),'graphdesk-edges':host.use(peer3.domain),'graphdesk-projections':host.use(peer4.domain),'graphdesk-queries':host.use(peer5.domain),'graphdesk-algorithms':host.use(peer6.domain),'graphdesk-runs':host.use(peer7.domain),'graphdesk-comparisons':host.use(peer8.domain),'graphdesk-annotations':host.use(peer9.domain),'graphdesk-views':host.use(peer10.domain),'graphdesk-reports':host.use(peer11.domain)},{'graphdesk-sources':host.use(peer1.domain)});host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.close());}
export const route=suiteRoute('graphdesk-exchange',schemas,services.domain,graphdeskRouteMetadata['exchange']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
