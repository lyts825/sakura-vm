/** 失败缩减：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {ProtostateReductions} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {protostateRouteMetadata} from '../../shared/contracts/protostate-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../protostate-spaces/services.ts';
import {services as peer1} from '../protostate-scenarios/services.ts';
import {services as peer2} from '../protostate-generators/services.ts';
import {services as peer3} from '../protostate-targets/services.ts';
import {services as peer4} from '../protostate-runs/services.ts';
import {services as peer5} from '../protostate-traces/services.ts';
import {services as peer6} from '../protostate-properties/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('protostate-reductions');
export async function activate(host:PluginContext){const service=new ProtostateReductions('protostate-reductions',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'protostate-spaces':host.use(peer0.domain),'protostate-scenarios':host.use(peer1.domain),'protostate-generators':host.use(peer2.domain),'protostate-targets':host.use(peer3.domain),'protostate-runs':host.use(peer4.domain),'protostate-traces':host.use(peer5.domain),'protostate-properties':host.use(peer6.domain)},requiredSeventhComputePort(host.system.optional('protocolScenarioSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('protostate-reductions',schemas,services.domain,protostateRouteMetadata['reductions']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
