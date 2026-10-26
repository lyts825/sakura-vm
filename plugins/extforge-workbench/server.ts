/** 开发工作台：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {ExtforgeWorkbench} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {extforgeRouteMetadata} from '../../shared/contracts/extforge-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../extforge-spaces/services.ts';
import {services as peer1} from '../extforge-sources/services.ts';
import {services as peer2} from '../extforge-manifests/services.ts';
import {services as peer3} from '../extforge-interfaces/services.ts';
import {services as peer4} from '../extforge-toolchains/services.ts';
import {services as peer5} from '../extforge-builds/services.ts';
import {services as peer6} from '../extforge-inspections/services.ts';
import {services as peer7} from '../extforge-cases/services.ts';
import {services as peer8} from '../extforge-trials/services.ts';
import {services as peer9} from '../extforge-signatures/services.ts';
import {services as peer10} from '../extforge-bundles/services.ts';
import {services as peer11} from '../extforge-reviews/services.ts';
import {services as peer12} from '../extforge-reports/services.ts';
import {services as peer13} from '../extforge-exchange/services.ts';
import {services as peer14} from '../extforge-catalogs/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('extforge-workbench');
export async function activate(host:PluginContext){const service=new ExtforgeWorkbench('extforge-workbench',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'extforge-spaces':host.use(peer0.domain),'extforge-sources':host.use(peer1.domain),'extforge-manifests':host.use(peer2.domain),'extforge-interfaces':host.use(peer3.domain),'extforge-toolchains':host.use(peer4.domain),'extforge-builds':host.use(peer5.domain),'extforge-inspections':host.use(peer6.domain),'extforge-cases':host.use(peer7.domain),'extforge-trials':host.use(peer8.domain),'extforge-signatures':host.use(peer9.domain),'extforge-bundles':host.use(peer10.domain),'extforge-reviews':host.use(peer11.domain),'extforge-reports':host.use(peer12.domain),'extforge-exchange':host.use(peer13.domain),'extforge-catalogs':host.use(peer14.domain)},requiredSeventhComputePort(host.system.optional('extensionTrialRuntime')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('extforge-workbench',schemas,services.domain,extforgeRouteMetadata['workbench']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
