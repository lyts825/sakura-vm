/** 内容选择：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {NtplRules} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {ntplRouteMetadata} from '../../shared/contracts/ntpl-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../ntpl-spaces/services.ts';
import {services as peer1} from '../ntpl-channels/services.ts';
import {services as peer2} from '../ntpl-templates/services.ts';
import {services as peer3} from '../ntpl-locales/services.ts';
import {services as peer4} from '../ntpl-audiences/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('ntpl-rules');
export async function activate(host:PluginContext){const service=new NtplRules('ntpl-rules',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'ntpl-spaces':host.use(peer0.domain),'ntpl-channels':host.use(peer1.domain),'ntpl-templates':host.use(peer2.domain),'ntpl-locales':host.use(peer3.domain),'ntpl-audiences':host.use(peer4.domain)},requiredSeventhComputePort(host.system.optional('notificationRenderCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('ntpl-rules',schemas,services.domain,ntplRouteMetadata['rules']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
