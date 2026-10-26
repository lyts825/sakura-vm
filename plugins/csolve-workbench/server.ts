/** 求解工作台：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {CsolveWorkbench} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {csolveRouteMetadata} from '../../shared/contracts/csolve-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../csolve-spaces/services.ts';
import {services as peer1} from '../csolve-variables/services.ts';
import {services as peer2} from '../csolve-domains/services.ts';
import {services as peer3} from '../csolve-constraints/services.ts';
import {services as peer4} from '../csolve-objectives/services.ts';
import {services as peer5} from '../csolve-scenarios/services.ts';
import {services as peer6} from '../csolve-runs/services.ts';
import {services as peer7} from '../csolve-solutions/services.ts';
import {services as peer8} from '../csolve-validation/services.ts';
import {services as peer9} from '../csolve-conflicts/services.ts';
import {services as peer10} from '../csolve-sensitivity/services.ts';
import {services as peer11} from '../csolve-decisions/services.ts';
import {services as peer12} from '../csolve-exchange/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('csolve-workbench');
export async function activate(host:PluginContext){const service=new CsolveWorkbench('csolve-workbench',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'csolve-spaces':host.use(peer0.domain),'csolve-variables':host.use(peer1.domain),'csolve-domains':host.use(peer2.domain),'csolve-constraints':host.use(peer3.domain),'csolve-objectives':host.use(peer4.domain),'csolve-scenarios':host.use(peer5.domain),'csolve-runs':host.use(peer6.domain),'csolve-solutions':host.use(peer7.domain),'csolve-validation':host.use(peer8.domain),'csolve-conflicts':host.use(peer9.domain),'csolve-sensitivity':host.use(peer10.domain),'csolve-decisions':host.use(peer11.domain),'csolve-exchange':host.use(peer12.domain)},requiredSeventhComputePort(host.system.optional('constraintSolveSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('csolve-workbench',schemas,services.domain,csolveRouteMetadata['workbench']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
