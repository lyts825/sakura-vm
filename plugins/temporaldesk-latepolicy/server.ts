/** 迟到策略：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {TemporaldeskLatepolicy} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {temporaldeskRouteMetadata} from '../../shared/contracts/temporaldesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../temporaldesk-spaces/services.ts';
import {services as peer1} from '../temporaldesk-semantics/services.ts';
import {services as peer2} from '../temporaldesk-windows/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('temporaldesk-latepolicy');
export async function activate(host:PluginContext){const service=new TemporaldeskLatepolicy('temporaldesk-latepolicy',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'temporaldesk-spaces':host.use(peer0.domain),'temporaldesk-semantics':host.use(peer1.domain),'temporaldesk-windows':host.use(peer2.domain)},requiredSeventhComputePort(host.system.optional('temporalSeriesCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('temporaldesk-latepolicy',schemas,services.domain,temporaldeskRouteMetadata['latepolicy']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
