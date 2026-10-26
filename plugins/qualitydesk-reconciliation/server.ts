/** 双侧对账：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {QualitydeskReconciliation} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {qualitydeskRouteMetadata} from '../../shared/contracts/qualitydesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../qualitydesk-spaces/services.ts';
import {services as peer1} from '../qualitydesk-sources/services.ts';
import {services as peer2} from '../qualitydesk-partitions/services.ts';
import {services as peer3} from '../qualitydesk-rules/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('qualitydesk-reconciliation');
export async function activate(host:PluginContext){const service=new QualitydeskReconciliation('qualitydesk-reconciliation',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'qualitydesk-spaces':host.use(peer0.domain),'qualitydesk-sources':host.use(peer1.domain),'qualitydesk-partitions':host.use(peer2.domain),'qualitydesk-rules':host.use(peer3.domain)},requiredSeventhComputePort(host.system.optional('batchQualityCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('qualitydesk-reconciliation',schemas,services.domain,qualitydeskRouteMetadata['reconciliation']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
