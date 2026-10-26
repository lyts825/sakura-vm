/** 调度工作台：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {SchedlabWorkbench} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {schedlabRouteMetadata} from '../../shared/contracts/schedlab-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../schedlab-spaces/services.ts';
import {services as peer1} from '../schedlab-calendars/services.ts';
import {services as peer2} from '../schedlab-clocks/services.ts';
import {services as peer3} from '../schedlab-rules/services.ts';
import {services as peer4} from '../schedlab-policies/services.ts';
import {services as peer5} from '../schedlab-workloads/services.ts';
import {services as peer6} from '../schedlab-scenarios/services.ts';
import {services as peer7} from '../schedlab-simulations/services.ts';
import {services as peer8} from '../schedlab-harness/services.ts';
import {services as peer9} from '../schedlab-observations/services.ts';
import {services as peer10} from '../schedlab-checks/services.ts';
import {services as peer11} from '../schedlab-reports/services.ts';
import {services as peer12} from '../schedlab-exchange/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('schedlab-workbench');
export async function activate(host:PluginContext){const service=new SchedlabWorkbench('schedlab-workbench',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'schedlab-spaces':host.use(peer0.domain),'schedlab-calendars':host.use(peer1.domain),'schedlab-clocks':host.use(peer2.domain),'schedlab-rules':host.use(peer3.domain),'schedlab-policies':host.use(peer4.domain),'schedlab-workloads':host.use(peer5.domain),'schedlab-scenarios':host.use(peer6.domain),'schedlab-simulations':host.use(peer7.domain),'schedlab-harness':host.use(peer8.domain),'schedlab-observations':host.use(peer9.domain),'schedlab-checks':host.use(peer10.domain),'schedlab-reports':host.use(peer11.domain),'schedlab-exchange':host.use(peer12.domain)},requiredSeventhComputePort(host.system.optional('scheduleModelCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('schedlab-workbench',schemas,services.domain,schedlabRouteMetadata['workbench']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
