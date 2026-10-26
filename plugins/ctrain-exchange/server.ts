/** 模型交接：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {CtrainExchange} from '../../server/seventh-domains.generated.ts';
import {SeventhComputePort} from '../../server/seventh-compute.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {ctrainRouteMetadata} from '../../shared/contracts/ctrain-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../ctrain-spaces/services.ts';
import {services as peer1} from '../ctrain-datasets/services.ts';
import {services as peer2} from '../ctrain-targets/services.ts';
import {services as peer3} from '../ctrain-partitions/services.ts';
import {services as peer4} from '../ctrain-estimators/services.ts';
import {services as peer5} from '../ctrain-searches/services.ts';
import {services as peer6} from '../ctrain-runs/services.ts';
import {services as peer7} from '../ctrain-predictions/services.ts';
import {services as peer8} from '../ctrain-metrics/services.ts';
import {services as peer9} from '../ctrain-comparisons/services.ts';
import {services as peer10} from '../ctrain-explanations/services.ts';
import {services as peer11} from '../ctrain-registry/services.ts';
import {services as peer12} from '../ctrain-reports/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('ctrain-exchange');
export async function activate(host:PluginContext){const service=new CtrainExchange('classical-training-lab',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('blobs',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'ctrain-spaces':host.use(peer0.domain),'ctrain-datasets':host.use(peer1.domain),'ctrain-targets':host.use(peer2.domain),'ctrain-partitions':host.use(peer3.domain),'ctrain-estimators':host.use(peer4.domain),'ctrain-searches':host.use(peer5.domain),'ctrain-runs':host.use(peer6.domain),'ctrain-predictions':host.use(peer7.domain),'ctrain-metrics':host.use(peer8.domain),'ctrain-comparisons':host.use(peer9.domain),'ctrain-explanations':host.use(peer10.domain),'ctrain-registry':host.use(peer11.domain),'ctrain-reports':host.use(peer12.domain)},{'ctrain-datasets':host.use(peer1.domain)});host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.close());}
export const route=suiteRoute('ctrain-exchange',schemas,services.domain,ctrainRouteMetadata['exchange']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
