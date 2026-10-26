/** 协议工作台：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {ProtostateWorkbench} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {protostateRouteMetadata} from '../../shared/contracts/protostate-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../protostate-spaces/services.ts';
import {services as peer1} from '../protostate-grammars/services.ts';
import {services as peer2} from '../protostate-messages/services.ts';
import {services as peer3} from '../protostate-machines/services.ts';
import {services as peer4} from '../protostate-guards/services.ts';
import {services as peer5} from '../protostate-scenarios/services.ts';
import {services as peer6} from '../protostate-generators/services.ts';
import {services as peer7} from '../protostate-targets/services.ts';
import {services as peer8} from '../protostate-runs/services.ts';
import {services as peer9} from '../protostate-traces/services.ts';
import {services as peer10} from '../protostate-properties/services.ts';
import {services as peer11} from '../protostate-reductions/services.ts';
import {services as peer12} from '../protostate-reports/services.ts';
import {services as peer13} from '../protostate-exchange/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('protostate-workbench');
export async function activate(host:PluginContext){const service=new ProtostateWorkbench('protostate-workbench',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'protostate-spaces':host.use(peer0.domain),'protostate-grammars':host.use(peer1.domain),'protostate-messages':host.use(peer2.domain),'protostate-machines':host.use(peer3.domain),'protostate-guards':host.use(peer4.domain),'protostate-scenarios':host.use(peer5.domain),'protostate-generators':host.use(peer6.domain),'protostate-targets':host.use(peer7.domain),'protostate-runs':host.use(peer8.domain),'protostate-traces':host.use(peer9.domain),'protostate-properties':host.use(peer10.domain),'protostate-reductions':host.use(peer11.domain),'protostate-reports':host.use(peer12.domain),'protostate-exchange':host.use(peer13.domain)},requiredSeventhComputePort(host.system.optional('protocolScenarioSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('protostate-workbench',schemas,services.domain,protostateRouteMetadata['workbench']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
