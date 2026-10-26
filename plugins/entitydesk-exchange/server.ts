/** 归并交接：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {EntitydeskExchange} from '../../server/seventh-domains.generated.ts';
import {SeventhComputePort} from '../../server/seventh-compute.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {entitydeskRouteMetadata} from '../../shared/contracts/entitydesk-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../entitydesk-spaces/services.ts';
import {services as peer1} from '../entitydesk-sources/services.ts';
import {services as peer2} from '../entitydesk-normalization/services.ts';
import {services as peer3} from '../entitydesk-blocks/services.ts';
import {services as peer4} from '../entitydesk-comparators/services.ts';
import {services as peer5} from '../entitydesk-candidates/services.ts';
import {services as peer6} from '../entitydesk-constraints/services.ts';
import {services as peer7} from '../entitydesk-clusters/services.ts';
import {services as peer8} from '../entitydesk-decisions/services.ts';
import {services as peer9} from '../entitydesk-evaluations/services.ts';
import {services as peer10} from '../entitydesk-survivors/services.ts';
import {services as peer11} from '../entitydesk-versions/services.ts';
import {services as peer12} from '../entitydesk-reports/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('entitydesk-exchange');
export async function activate(host:PluginContext){const service=new EntitydeskExchange('entity-resolution-studio',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('blobs',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'entitydesk-spaces':host.use(peer0.domain),'entitydesk-sources':host.use(peer1.domain),'entitydesk-normalization':host.use(peer2.domain),'entitydesk-blocks':host.use(peer3.domain),'entitydesk-comparators':host.use(peer4.domain),'entitydesk-candidates':host.use(peer5.domain),'entitydesk-constraints':host.use(peer6.domain),'entitydesk-clusters':host.use(peer7.domain),'entitydesk-decisions':host.use(peer8.domain),'entitydesk-evaluations':host.use(peer9.domain),'entitydesk-survivors':host.use(peer10.domain),'entitydesk-versions':host.use(peer11.domain),'entitydesk-reports':host.use(peer12.domain)},{'entitydesk-sources':host.use(peer1.domain)});host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.close());}
export const route=suiteRoute('entitydesk-exchange',schemas,services.domain,entitydeskRouteMetadata['exchange']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
