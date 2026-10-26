/** 约束模型：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {DepsolveConstraints} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {depsolveRouteMetadata} from '../../shared/contracts/depsolve-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../depsolve-spaces/services.ts';
import {services as peer1} from '../depsolve-catalogs/services.ts';
import {services as peer2} from '../depsolve-roots/services.ts';
import {services as peer3} from '../depsolve-platforms/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('depsolve-constraints');
export async function activate(host:PluginContext){const service=new DepsolveConstraints('depsolve-constraints',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'depsolve-spaces':host.use(peer0.domain),'depsolve-catalogs':host.use(peer1.domain),'depsolve-roots':host.use(peer2.domain),'depsolve-platforms':host.use(peer3.domain)},requiredSeventhComputePort(host.system.optional('dependencyConstraintCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('depsolve-constraints',schemas,services.domain,depsolveRouteMetadata['constraints']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
