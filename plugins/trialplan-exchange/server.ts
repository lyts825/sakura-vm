/** 实验资料交接：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {TrialplanExchange} from '../../server/seventh-domains.generated.ts';
import {SeventhComputePort} from '../../server/seventh-compute.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {trialplanRouteMetadata} from '../../shared/contracts/trialplan-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../trialplan-spaces/services.ts';
import {services as peer1} from '../trialplan-questions/services.ts';
import {services as peer2} from '../trialplan-populations/services.ts';
import {services as peer3} from '../trialplan-outcomes/services.ts';
import {services as peer4} from '../trialplan-allocations/services.ts';
import {services as peer5} from '../trialplan-powerplans/services.ts';
import {services as peer6} from '../trialplan-assignments/services.ts';
import {services as peer7} from '../trialplan-observations/services.ts';
import {services as peer8} from '../trialplan-analyses/services.ts';
import {services as peer9} from '../trialplan-sensitivity/services.ts';
import {services as peer10} from '../trialplan-reviews/services.ts';
import {services as peer11} from '../trialplan-reports/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('trialplan-exchange');
export async function activate(host:PluginContext){const service=new TrialplanExchange('experiment-planner',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('blobs',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'trialplan-spaces':host.use(peer0.domain),'trialplan-questions':host.use(peer1.domain),'trialplan-populations':host.use(peer2.domain),'trialplan-outcomes':host.use(peer3.domain),'trialplan-allocations':host.use(peer4.domain),'trialplan-powerplans':host.use(peer5.domain),'trialplan-assignments':host.use(peer6.domain),'trialplan-observations':host.use(peer7.domain),'trialplan-analyses':host.use(peer8.domain),'trialplan-sensitivity':host.use(peer9.domain),'trialplan-reviews':host.use(peer10.domain),'trialplan-reports':host.use(peer11.domain)},{'trialplan-populations':host.use(peer2.domain),'trialplan-observations':host.use(peer7.domain)});host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.close());}
export const route=suiteRoute('trialplan-exchange',schemas,services.domain,trialplanRouteMetadata['exchange']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
