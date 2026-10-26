/** 环境版本：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {VirtservicePackages} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {virtserviceRouteMetadata} from '../../shared/contracts/virtservice-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../virtservice-spaces/services.ts';
import {services as peer1} from '../virtservice-contracts/services.ts';
import {services as peer2} from '../virtservice-payloads/services.ts';
import {services as peer3} from '../virtservice-matchers/services.ts';
import {services as peer4} from '../virtservice-states/services.ts';
import {services as peer5} from '../virtservice-transitions/services.ts';
import {services as peer6} from '../virtservice-faults/services.ts';
import {services as peer7} from '../virtservice-scenarios/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('virtservice-packages');
export async function activate(host:PluginContext){const service=new VirtservicePackages('virtservice-packages',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'virtservice-spaces':host.use(peer0.domain),'virtservice-contracts':host.use(peer1.domain),'virtservice-payloads':host.use(peer2.domain),'virtservice-matchers':host.use(peer3.domain),'virtservice-states':host.use(peer4.domain),'virtservice-transitions':host.use(peer5.domain),'virtservice-faults':host.use(peer6.domain),'virtservice-scenarios':host.use(peer7.domain)},requiredSeventhComputePort(host.system.optional('multiServiceVirtualizationSessions')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('virtservice-packages',schemas,services.domain,virtserviceRouteMetadata['packages']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
