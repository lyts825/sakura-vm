/** 开发报告：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {ExtforgeReports} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {extforgeRouteMetadata} from '../../shared/contracts/extforge-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../extforge-spaces/services.ts';
import {services as peer1} from '../extforge-builds/services.ts';
import {services as peer2} from '../extforge-inspections/services.ts';
import {services as peer3} from '../extforge-trials/services.ts';
import {services as peer4} from '../extforge-signatures/services.ts';
import {services as peer5} from '../extforge-bundles/services.ts';
import {services as peer6} from '../extforge-reviews/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('extforge-reports');
export async function activate(host:PluginContext){const service=new ExtforgeReports('extforge-reports',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'extforge-spaces':host.use(peer0.domain),'extforge-builds':host.use(peer1.domain),'extforge-inspections':host.use(peer2.domain),'extforge-trials':host.use(peer3.domain),'extforge-signatures':host.use(peer4.domain),'extforge-bundles':host.use(peer5.domain),'extforge-reviews':host.use(peer6.domain)},requiredSeventhComputePort(host.system.optional('extensionTrialRuntime')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('extforge-reports',schemas,services.domain,extforgeRouteMetadata['reports']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
