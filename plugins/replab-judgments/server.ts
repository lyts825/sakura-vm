/** 性质判断：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {ReplabJudgments} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {replabRouteMetadata} from '../../shared/contracts/replab-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../replab-spaces/services.ts';
import {services as peer1} from '../replab-schemas/services.ts';
import {services as peer2} from '../replab-scenarios/services.ts';
import {services as peer3} from '../replab-runs/services.ts';
import {services as peer4} from '../replab-conflicts/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('replab-judgments');
export async function activate(host:PluginContext){const service=new ReplabJudgments('replab-judgments',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'replab-spaces':host.use(peer0.domain),'replab-schemas':host.use(peer1.domain),'replab-scenarios':host.use(peer2.domain),'replab-runs':host.use(peer3.domain),'replab-conflicts':host.use(peer4.domain)},requiredSeventhComputePort(host.system.optional('replicaModelCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('replab-judgments',schemas,services.domain,replabRouteMetadata['judgments']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
