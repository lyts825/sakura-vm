/** 有限重放：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {ReplabRuns} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {replabRouteMetadata} from '../../shared/contracts/replab-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../replab-spaces/services.ts';
import {services as peer1} from '../replab-schemas/services.ts';
import {services as peer2} from '../replab-replicas/services.ts';
import {services as peer3} from '../replab-operations/services.ts';
import {services as peer4} from '../replab-clocks/services.ts';
import {services as peer5} from '../replab-channels/services.ts';
import {services as peer6} from '../replab-policies/services.ts';
import {services as peer7} from '../replab-scenarios/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('replab-runs');
export async function activate(host:PluginContext){const service=new ReplabRuns('replab-runs',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'replab-spaces':host.use(peer0.domain),'replab-schemas':host.use(peer1.domain),'replab-replicas':host.use(peer2.domain),'replab-operations':host.use(peer3.domain),'replab-clocks':host.use(peer4.domain),'replab-channels':host.use(peer5.domain),'replab-policies':host.use(peer6.domain),'replab-scenarios':host.use(peer7.domain)},requiredSeventhComputePort(host.system.optional('replicaModelCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('replab-runs',schemas,services.domain,replabRouteMetadata['runs']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
