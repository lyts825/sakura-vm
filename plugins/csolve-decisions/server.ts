/** 方案接受：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {CsolveDecisions} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {csolveRouteMetadata} from '../../shared/contracts/csolve-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../csolve-spaces/services.ts';
import {services as peer1} from '../csolve-scenarios/services.ts';
import {services as peer2} from '../csolve-solutions/services.ts';
import {services as peer3} from '../csolve-validation/services.ts';
import {services as peer4} from '../csolve-conflicts/services.ts';
import {services as peer5} from '../csolve-sensitivity/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('csolve-decisions');
export async function activate(host:PluginContext){const service=new CsolveDecisions('csolve-decisions',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'csolve-spaces':host.use(peer0.domain),'csolve-scenarios':host.use(peer1.domain),'csolve-solutions':host.use(peer2.domain),'csolve-validation':host.use(peer3.domain),'csolve-conflicts':host.use(peer4.domain),'csolve-sensitivity':host.use(peer5.domain)},requiredSeventhComputePort(host.system.optional('constraintSolveSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('csolve-decisions',schemas,services.domain,csolveRouteMetadata['decisions']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
