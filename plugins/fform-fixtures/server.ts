/** 样例材料：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {FformFixtures} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {fformRouteMetadata} from '../../shared/contracts/fform-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../fform-spaces/services.ts';
import {services as peer1} from '../fform-fields/services.ts';
import {services as peer2} from '../fform-schemas/services.ts';
import {services as peer3} from '../fform-pages/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('fform-fixtures');
export async function activate(host:PluginContext){const service=new FformFixtures('fform-fixtures',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'fform-spaces':host.use(peer0.domain),'fform-fields':host.use(peer1.domain),'fform-schemas':host.use(peer2.domain),'fform-pages':host.use(peer3.domain)},requiredSeventhComputePort(host.system.optional('formDefinitionEvaluate')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('fform-fixtures',schemas,services.domain,fformRouteMetadata['fixtures']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
