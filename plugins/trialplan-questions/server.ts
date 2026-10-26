/** 研究问题：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {TrialplanQuestions} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {trialplanRouteMetadata} from '../../shared/contracts/trialplan-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../trialplan-spaces/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('trialplan-questions');
export async function activate(host:PluginContext){const service=new TrialplanQuestions('trialplan-questions',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'trialplan-spaces':host.use(peer0.domain)},requiredSeventhComputePort(host.system.optional('controlledExperimentCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('trialplan-questions',schemas,services.domain,trialplanRouteMetadata['questions']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
