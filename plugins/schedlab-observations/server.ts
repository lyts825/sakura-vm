/** 触发观察：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {SchedlabObservations} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {schedlabRouteMetadata} from '../../shared/contracts/schedlab-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../schedlab-spaces/services.ts';
import {services as peer1} from '../schedlab-clocks/services.ts';
import {services as peer2} from '../schedlab-simulations/services.ts';
import {services as peer3} from '../schedlab-harness/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('schedlab-observations');
export async function activate(host:PluginContext){const service=new SchedlabObservations('schedlab-observations',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'schedlab-spaces':host.use(peer0.domain),'schedlab-clocks':host.use(peer1.domain),'schedlab-simulations':host.use(peer2.domain),'schedlab-harness':host.use(peer3.domain)},requiredSeventhComputePort(host.system.optional('scheduleModelCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('schedlab-observations',schemas,services.domain,schedlabRouteMetadata['observations']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
