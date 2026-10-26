/** 沙箱试运行：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {ExtforgeTrials} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {extforgeRouteMetadata} from '../../shared/contracts/extforge-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../extforge-spaces/services.ts';
import {services as peer1} from '../extforge-builds/services.ts';
import {services as peer2} from '../extforge-inspections/services.ts';
import {services as peer3} from '../extforge-cases/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('extforge-trials');
export async function activate(host:PluginContext){const service=new ExtforgeTrials('extforge-trials',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'extforge-spaces':host.use(peer0.domain),'extforge-builds':host.use(peer1.domain),'extforge-inspections':host.use(peer2.domain),'extforge-cases':host.use(peer3.domain)},requiredSeventhComputePort(host.system.optional('extensionTrialRuntime')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('extforge-trials',schemas,services.domain,extforgeRouteMetadata['trials']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
