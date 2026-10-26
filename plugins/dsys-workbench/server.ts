/** 系统工作台：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {DsysWorkbench} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {dsysRouteMetadata} from '../../shared/contracts/dsys-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../dsys-spaces/services.ts';
import {services as peer1} from '../dsys-tokens/services.ts';
import {services as peer2} from '../dsys-themes/services.ts';
import {services as peer3} from '../dsys-typography/services.ts';
import {services as peer4} from '../dsys-icons/services.ts';
import {services as peer5} from '../dsys-components/services.ts';
import {services as peer6} from '../dsys-states/services.ts';
import {services as peer7} from '../dsys-layouts/services.ts';
import {services as peer8} from '../dsys-checks/services.ts';
import {services as peer9} from '../dsys-builds/services.ts';
import {services as peer10} from '../dsys-reviews/services.ts';
import {services as peer11} from '../dsys-exchange/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('dsys-workbench');
export async function activate(host:PluginContext){const service=new DsysWorkbench('dsys-workbench',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'dsys-spaces':host.use(peer0.domain),'dsys-tokens':host.use(peer1.domain),'dsys-themes':host.use(peer2.domain),'dsys-typography':host.use(peer3.domain),'dsys-icons':host.use(peer4.domain),'dsys-components':host.use(peer5.domain),'dsys-states':host.use(peer6.domain),'dsys-layouts':host.use(peer7.domain),'dsys-checks':host.use(peer8.domain),'dsys-builds':host.use(peer9.domain),'dsys-reviews':host.use(peer10.domain),'dsys-exchange':host.use(peer11.domain)},requiredSeventhComputePort(host.system.optional('designSystemCompile')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('dsys-workbench',schemas,services.domain,dsysRouteMetadata['workbench']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
