/** 模拟报告：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {VirtserviceReports} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {virtserviceRouteMetadata} from '../../shared/contracts/virtservice-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../virtservice-spaces/services.ts';
import {services as peer1} from '../virtservice-packages/services.ts';
import {services as peer2} from '../virtservice-sessions/services.ts';
import {services as peer3} from '../virtservice-traffic/services.ts';
import {services as peer4} from '../virtservice-assertions/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('virtservice-reports');
export async function activate(host:PluginContext){const service=new VirtserviceReports('virtservice-reports',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'virtservice-spaces':host.use(peer0.domain),'virtservice-packages':host.use(peer1.domain),'virtservice-sessions':host.use(peer2.domain),'virtservice-traffic':host.use(peer3.domain),'virtservice-assertions':host.use(peer4.domain)},requiredSeventhComputePort(host.system.optional('multiServiceVirtualizationSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('virtservice-reports',schemas,services.domain,virtserviceRouteMetadata['reports']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
