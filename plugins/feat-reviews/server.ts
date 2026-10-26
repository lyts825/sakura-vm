/** 使用复核：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {FeatReviews} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {featRouteMetadata} from '../../shared/contracts/feat-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../feat-spaces/services.ts';
import {services as peer1} from '../feat-artifacts/services.ts';
import {services as peer2} from '../feat-checks/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('feat-reviews');
export async function activate(host:PluginContext){const service=new FeatReviews('feat-reviews',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'feat-spaces':host.use(peer0.domain),'feat-artifacts':host.use(peer1.domain),'feat-checks':host.use(peer2.domain)},requiredSeventhComputePort(host.system.optional('featureTransformCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('feat-reviews',schemas,services.domain,featRouteMetadata['reviews']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
