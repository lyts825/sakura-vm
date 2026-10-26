/** 求解报告：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {DepsolveReports} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {depsolveRouteMetadata} from '../../shared/contracts/depsolve-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../depsolve-spaces/services.ts';
import {services as peer1} from '../depsolve-constraints/services.ts';
import {services as peer2} from '../depsolve-solves/services.ts';
import {services as peer3} from '../depsolve-proofs/services.ts';
import {services as peer4} from '../depsolve-comparisons/services.ts';
import {services as peer5} from '../depsolve-locks/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('depsolve-reports');
export async function activate(host:PluginContext){const service=new DepsolveReports('depsolve-reports',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'depsolve-spaces':host.use(peer0.domain),'depsolve-constraints':host.use(peer1.domain),'depsolve-solves':host.use(peer2.domain),'depsolve-proofs':host.use(peer3.domain),'depsolve-comparisons':host.use(peer4.domain),'depsolve-locks':host.use(peer5.domain)},requiredSeventhComputePort(host.system.optional('dependencyConstraintCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('depsolve-reports',schemas,services.domain,depsolveRouteMetadata['reports']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
