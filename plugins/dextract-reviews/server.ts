/** 提取复核：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {DextractReviews} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {dextractRouteMetadata} from '../../shared/contracts/dextract-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../dextract-spaces/services.ts';
import {services as peer1} from '../dextract-datasets/services.ts';
import {services as peer2} from '../dextract-checks/services.ts';
import {services as peer3} from '../dextract-corrections/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('dextract-reviews');
export async function activate(host:PluginContext){const service=new DextractReviews('dextract-reviews',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'dextract-spaces':host.use(peer0.domain),'dextract-datasets':host.use(peer1.domain),'dextract-checks':host.use(peer2.domain),'dextract-corrections':host.use(peer3.domain)},requiredSeventhComputePort(host.system.optional('documentExtractionSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('dextract-reviews',schemas,services.domain,dextractRouteMetadata['reviews']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
