/** 设计与结果复核：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {TrialplanReviews} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {trialplanRouteMetadata} from '../../shared/contracts/trialplan-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../trialplan-spaces/services.ts';
import {services as peer1} from '../trialplan-questions/services.ts';
import {services as peer2} from '../trialplan-powerplans/services.ts';
import {services as peer3} from '../trialplan-assignments/services.ts';
import {services as peer4} from '../trialplan-observations/services.ts';
import {services as peer5} from '../trialplan-analyses/services.ts';
import {services as peer6} from '../trialplan-sensitivity/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('trialplan-reviews');
export async function activate(host:PluginContext){const service=new TrialplanReviews('trialplan-reviews',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'trialplan-spaces':host.use(peer0.domain),'trialplan-questions':host.use(peer1.domain),'trialplan-powerplans':host.use(peer2.domain),'trialplan-assignments':host.use(peer3.domain),'trialplan-observations':host.use(peer4.domain),'trialplan-analyses':host.use(peer5.domain),'trialplan-sensitivity':host.use(peer6.domain)},requiredSeventhComputePort(host.system.optional('controlledExperimentCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('trialplan-reviews',schemas,services.domain,trialplanRouteMetadata['reviews']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
