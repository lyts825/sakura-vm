/** 时间工作台：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {TemporaldeskWorkbench} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {temporaldeskRouteMetadata} from '../../shared/contracts/temporaldesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../temporaldesk-spaces/services.ts';
import {services as peer1} from '../temporaldesk-sources/services.ts';
import {services as peer2} from '../temporaldesk-calendars/services.ts';
import {services as peer3} from '../temporaldesk-semantics/services.ts';
import {services as peer4} from '../temporaldesk-alignment/services.ts';
import {services as peer5} from '../temporaldesk-intervals/services.ts';
import {services as peer6} from '../temporaldesk-windows/services.ts';
import {services as peer7} from '../temporaldesk-latepolicy/services.ts';
import {services as peer8} from '../temporaldesk-runs/services.ts';
import {services as peer9} from '../temporaldesk-comparisons/services.ts';
import {services as peer10} from '../temporaldesk-reviews/services.ts';
import {services as peer11} from '../temporaldesk-reports/services.ts';
import {services as peer12} from '../temporaldesk-exchange/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('temporaldesk-workbench');
export async function activate(host:PluginContext){const service=new TemporaldeskWorkbench('temporaldesk-workbench',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'temporaldesk-spaces':host.use(peer0.domain),'temporaldesk-sources':host.use(peer1.domain),'temporaldesk-calendars':host.use(peer2.domain),'temporaldesk-semantics':host.use(peer3.domain),'temporaldesk-alignment':host.use(peer4.domain),'temporaldesk-intervals':host.use(peer5.domain),'temporaldesk-windows':host.use(peer6.domain),'temporaldesk-latepolicy':host.use(peer7.domain),'temporaldesk-runs':host.use(peer8.domain),'temporaldesk-comparisons':host.use(peer9.domain),'temporaldesk-reviews':host.use(peer10.domain),'temporaldesk-reports':host.use(peer11.domain),'temporaldesk-exchange':host.use(peer12.domain)},requiredSeventhComputePort(host.system.optional('temporalSeriesCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('temporaldesk-workbench',schemas,services.domain,temporaldeskRouteMetadata['workbench']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
