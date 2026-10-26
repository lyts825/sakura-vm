/** 取值域：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {CsolveDomains} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {csolveRouteMetadata} from '../../shared/contracts/csolve-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../csolve-spaces/services.ts';
import {services as peer1} from '../csolve-variables/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('csolve-domains');
export async function activate(host:PluginContext){const service=new CsolveDomains('csolve-domains',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'csolve-spaces':host.use(peer0.domain),'csolve-variables':host.use(peer1.domain)},requiredSeventhComputePort(host.system.optional('constraintSolveSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('csolve-domains',schemas,services.domain,csolveRouteMetadata['domains']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
