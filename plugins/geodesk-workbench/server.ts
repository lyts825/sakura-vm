/** 地理工作台：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {GeodeskWorkbench} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {geodeskRouteMetadata} from '../../shared/contracts/geodesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../geodesk-spaces/services.ts';
import {services as peer1} from '../geodesk-sources/services.ts';
import {services as peer2} from '../geodesk-crs/services.ts';
import {services as peer3} from '../geodesk-validation/services.ts';
import {services as peer4} from '../geodesk-layers/services.ts';
import {services as peer5} from '../geodesk-operations/services.ts';
import {services as peer6} from '../geodesk-joins/services.ts';
import {services as peer7} from '../geodesk-indexes/services.ts';
import {services as peer8} from '../geodesk-runs/services.ts';
import {services as peer9} from '../geodesk-measures/services.ts';
import {services as peer10} from '../geodesk-styles/services.ts';
import {services as peer11} from '../geodesk-reviews/services.ts';
import {services as peer12} from '../geodesk-reports/services.ts';
import {services as peer13} from '../geodesk-exchange/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('geodesk-workbench');
export async function activate(host:PluginContext){const service=new GeodeskWorkbench('geodesk-workbench',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'geodesk-spaces':host.use(peer0.domain),'geodesk-sources':host.use(peer1.domain),'geodesk-crs':host.use(peer2.domain),'geodesk-validation':host.use(peer3.domain),'geodesk-layers':host.use(peer4.domain),'geodesk-operations':host.use(peer5.domain),'geodesk-joins':host.use(peer6.domain),'geodesk-indexes':host.use(peer7.domain),'geodesk-runs':host.use(peer8.domain),'geodesk-measures':host.use(peer9.domain),'geodesk-styles':host.use(peer10.domain),'geodesk-reviews':host.use(peer11.domain),'geodesk-reports':host.use(peer12.domain),'geodesk-exchange':host.use(peer13.domain)},requiredSeventhComputePort(host.system.optional('vectorGeometryCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('geodesk-workbench',schemas,services.domain,geodeskRouteMetadata['workbench']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
