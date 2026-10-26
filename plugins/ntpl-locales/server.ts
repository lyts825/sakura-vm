/** 语言变体：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {NtplLocales} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {ntplRouteMetadata} from '../../shared/contracts/ntpl-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../ntpl-spaces/services.ts';
import {services as peer1} from '../ntpl-variables/services.ts';
import {services as peer2} from '../ntpl-templates/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('ntpl-locales');
export async function activate(host:PluginContext){const service=new NtplLocales('ntpl-locales',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'ntpl-spaces':host.use(peer0.domain),'ntpl-variables':host.use(peer1.domain),'ntpl-templates':host.use(peer2.domain)},requiredSeventhComputePort(host.system.optional('notificationRenderCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('ntpl-locales',schemas,services.domain,ntplRouteMetadata['locales']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
