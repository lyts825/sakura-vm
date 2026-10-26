/** 通知工作台：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {NtplWorkbench} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {ntplRouteMetadata} from '../../shared/contracts/ntpl-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../ntpl-spaces/services.ts';
import {services as peer1} from '../ntpl-variables/services.ts';
import {services as peer2} from '../ntpl-channels/services.ts';
import {services as peer3} from '../ntpl-templates/services.ts';
import {services as peer4} from '../ntpl-locales/services.ts';
import {services as peer5} from '../ntpl-assets/services.ts';
import {services as peer6} from '../ntpl-audiences/services.ts';
import {services as peer7} from '../ntpl-rules/services.ts';
import {services as peer8} from '../ntpl-renders/services.ts';
import {services as peer9} from '../ntpl-inboxes/services.ts';
import {services as peer10} from '../ntpl-checks/services.ts';
import {services as peer11} from '../ntpl-releases/services.ts';
import {services as peer12} from '../ntpl-exchange/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('ntpl-workbench');
export async function activate(host:PluginContext){const service=new NtplWorkbench('ntpl-workbench',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'ntpl-spaces':host.use(peer0.domain),'ntpl-variables':host.use(peer1.domain),'ntpl-channels':host.use(peer2.domain),'ntpl-templates':host.use(peer3.domain),'ntpl-locales':host.use(peer4.domain),'ntpl-assets':host.use(peer5.domain),'ntpl-audiences':host.use(peer6.domain),'ntpl-rules':host.use(peer7.domain),'ntpl-renders':host.use(peer8.domain),'ntpl-inboxes':host.use(peer9.domain),'ntpl-checks':host.use(peer10.domain),'ntpl-releases':host.use(peer11.domain),'ntpl-exchange':host.use(peer12.domain)},requiredSeventhComputePort(host.system.optional('notificationRenderCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('ntpl-workbench',schemas,services.domain,ntplRouteMetadata['workbench']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
