/** 条件约束：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {ProtostateGuards} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {protostateRouteMetadata} from '../../shared/contracts/protostate-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../protostate-spaces/services.ts';
import {services as peer1} from '../protostate-grammars/services.ts';
import {services as peer2} from '../protostate-machines/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('protostate-guards');
export async function activate(host:PluginContext){const service=new ProtostateGuards('protostate-guards',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'protostate-spaces':host.use(peer0.domain),'protostate-grammars':host.use(peer1.domain),'protostate-machines':host.use(peer2.domain)},requiredSeventhComputePort(host.system.optional('protocolScenarioSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('protostate-guards',schemas,services.domain,protostateRouteMetadata['guards']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
