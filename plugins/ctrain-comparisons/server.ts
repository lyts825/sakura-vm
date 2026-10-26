/** 候选比较：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {CtrainComparisons} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {ctrainRouteMetadata} from '../../shared/contracts/ctrain-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../ctrain-spaces/services.ts';
import {services as peer1} from '../ctrain-searches/services.ts';
import {services as peer2} from '../ctrain-runs/services.ts';
import {services as peer3} from '../ctrain-metrics/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('ctrain-comparisons');
export async function activate(host:PluginContext){const service=new CtrainComparisons('ctrain-comparisons',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'ctrain-spaces':host.use(peer0.domain),'ctrain-searches':host.use(peer1.domain),'ctrain-runs':host.use(peer2.domain),'ctrain-metrics':host.use(peer3.domain)},requiredSeventhComputePort(host.system.optional('classicalTrainingSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('ctrain-comparisons',schemas,services.domain,ctrainRouteMetadata['comparisons']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
