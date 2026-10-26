/** 情景比较：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {CsolveSensitivity} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {csolveRouteMetadata} from '../../shared/contracts/csolve-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../csolve-spaces/services.ts';
import {services as peer1} from '../csolve-scenarios/services.ts';
import {services as peer2} from '../csolve-runs/services.ts';
import {services as peer3} from '../csolve-solutions/services.ts';
import {services as peer4} from '../csolve-validation/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('csolve-sensitivity');
export async function activate(host:PluginContext){const service=new CsolveSensitivity('csolve-sensitivity',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'csolve-spaces':host.use(peer0.domain),'csolve-scenarios':host.use(peer1.domain),'csolve-runs':host.use(peer2.domain),'csolve-solutions':host.use(peer3.domain),'csolve-validation':host.use(peer4.domain)},requiredSeventhComputePort(host.system.optional('constraintSolveSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('csolve-sensitivity',schemas,services.domain,csolveRouteMetadata['sensitivity']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
