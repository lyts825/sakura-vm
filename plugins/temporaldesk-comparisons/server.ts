/** 时间比较：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {TemporaldeskComparisons} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {temporaldeskRouteMetadata} from '../../shared/contracts/temporaldesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../temporaldesk-spaces/services.ts';
import {services as peer1} from '../temporaldesk-runs/services.ts';
import {services as peer2} from '../temporaldesk-windows/services.ts';
import {services as peer3} from '../temporaldesk-latepolicy/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('temporaldesk-comparisons');
export async function activate(host:PluginContext){const service=new TemporaldeskComparisons('temporaldesk-comparisons',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'temporaldesk-spaces':host.use(peer0.domain),'temporaldesk-runs':host.use(peer1.domain),'temporaldesk-windows':host.use(peer2.domain),'temporaldesk-latepolicy':host.use(peer3.domain)},requiredSeventhComputePort(host.system.optional('temporalSeriesCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('temporaldesk-comparisons',schemas,services.domain,temporaldeskRouteMetadata['comparisons']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
