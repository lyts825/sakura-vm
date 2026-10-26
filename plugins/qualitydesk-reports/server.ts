/** 质量档案：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {QualitydeskReports} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {qualitydeskRouteMetadata} from '../../shared/contracts/qualitydesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../qualitydesk-spaces/services.ts';
import {services as peer1} from '../qualitydesk-profiles/services.ts';
import {services as peer2} from '../qualitydesk-baselines/services.ts';
import {services as peer3} from '../qualitydesk-runs/services.ts';
import {services as peer4} from '../qualitydesk-findings/services.ts';
import {services as peer5} from '../qualitydesk-reconciliation/services.ts';
import {services as peer6} from '../qualitydesk-exceptions/services.ts';
import {services as peer7} from '../qualitydesk-releases/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('qualitydesk-reports');
export async function activate(host:PluginContext){const service=new QualitydeskReports('qualitydesk-reports',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'qualitydesk-spaces':host.use(peer0.domain),'qualitydesk-profiles':host.use(peer1.domain),'qualitydesk-baselines':host.use(peer2.domain),'qualitydesk-runs':host.use(peer3.domain),'qualitydesk-findings':host.use(peer4.domain),'qualitydesk-reconciliation':host.use(peer5.domain),'qualitydesk-exceptions':host.use(peer6.domain),'qualitydesk-releases':host.use(peer7.domain)},requiredSeventhComputePort(host.system.optional('batchQualityCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('qualitydesk-reports',schemas,services.domain,qualitydeskRouteMetadata['reports']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
