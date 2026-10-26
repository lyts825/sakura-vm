/** 表单版本：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {FformVersions} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {fformRouteMetadata} from '../../shared/contracts/fform-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../fform-spaces/services.ts';
import {services as peer1} from '../fform-fields/services.ts';
import {services as peer2} from '../fform-schemas/services.ts';
import {services as peer3} from '../fform-logic/services.ts';
import {services as peer4} from '../fform-pages/services.ts';
import {services as peer5} from '../fform-fixtures/services.ts';
import {services as peer6} from '../fform-validations/services.ts';
import {services as peer7} from '../fform-submissions/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('fform-versions');
export async function activate(host:PluginContext){const service=new FformVersions('fform-versions',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'fform-spaces':host.use(peer0.domain),'fform-fields':host.use(peer1.domain),'fform-schemas':host.use(peer2.domain),'fform-logic':host.use(peer3.domain),'fform-pages':host.use(peer4.domain),'fform-fixtures':host.use(peer5.domain),'fform-validations':host.use(peer6.domain),'fform-submissions':host.use(peer7.domain)},requiredSeventhComputePort(host.system.optional('formDefinitionEvaluate')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('fform-versions',schemas,services.domain,fformRouteMetadata['versions']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
