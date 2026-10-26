/** 基线窗口：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {QualitydeskBaselines} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {qualitydeskRouteMetadata} from '../../shared/contracts/qualitydesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../qualitydesk-spaces/services.ts';
import {services as peer1} from '../qualitydesk-partitions/services.ts';
import {services as peer2} from '../qualitydesk-profiles/services.ts';
import {services as peer3} from '../qualitydesk-rules/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('qualitydesk-baselines');
export async function activate(host:PluginContext){const service=new QualitydeskBaselines('qualitydesk-baselines',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'qualitydesk-spaces':host.use(peer0.domain),'qualitydesk-partitions':host.use(peer1.domain),'qualitydesk-profiles':host.use(peer2.domain),'qualitydesk-rules':host.use(peer3.domain)},requiredSeventhComputePort(host.system.optional('batchQualityCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('qualitydesk-baselines',schemas,services.domain,qualitydeskRouteMetadata['baselines']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
