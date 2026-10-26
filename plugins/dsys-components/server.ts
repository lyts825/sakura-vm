/** 组件规格：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {DsysComponents} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {dsysRouteMetadata} from '../../shared/contracts/dsys-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../dsys-spaces/services.ts';
import {services as peer1} from '../dsys-tokens/services.ts';
import {services as peer2} from '../dsys-themes/services.ts';
import {services as peer3} from '../dsys-typography/services.ts';
import {services as peer4} from '../dsys-icons/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('dsys-components');
export async function activate(host:PluginContext){const service=new DsysComponents('dsys-components',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'dsys-spaces':host.use(peer0.domain),'dsys-tokens':host.use(peer1.domain),'dsys-themes':host.use(peer2.domain),'dsys-typography':host.use(peer3.domain),'dsys-icons':host.use(peer4.domain)},requiredSeventhComputePort(host.system.optional('designSystemCompile')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('dsys-components',schemas,services.domain,dsysRouteMetadata['components']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
