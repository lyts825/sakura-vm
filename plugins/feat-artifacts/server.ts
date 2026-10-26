/** 特征版本：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {FeatArtifacts} from '../../server/seventh-domains.generated.ts';
import {requiredSeventhComputePort} from '../../server/seventh-compute-port-required.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {featRouteMetadata} from '../../shared/contracts/feat-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../feat-spaces/services.ts';
import {services as peer1} from '../feat-sources/services.ts';
import {services as peer2} from '../feat-schemas/services.ts';
import {services as peer3} from '../feat-partitions/services.ts';
import {services as peer4} from '../feat-transforms/services.ts';
import {services as peer5} from '../feat-joins/services.ts';
import {services as peer6} from '../feat-windows/services.ts';
import {services as peer7} from '../feat-fits/services.ts';
import {services as peer8} from '../feat-selections/services.ts';
import {services as peer9} from '../feat-runs/services.ts';
import {services as peer10} from '../feat-checks/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('feat-artifacts');
export async function activate(host:PluginContext){const service=new FeatArtifacts('feat-artifacts',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'feat-spaces':host.use(peer0.domain),'feat-sources':host.use(peer1.domain),'feat-schemas':host.use(peer2.domain),'feat-partitions':host.use(peer3.domain),'feat-transforms':host.use(peer4.domain),'feat-joins':host.use(peer5.domain),'feat-windows':host.use(peer6.domain),'feat-fits':host.use(peer7.domain),'feat-selections':host.use(peer8.domain),'feat-runs':host.use(peer9.domain),'feat-checks':host.use(peer10.domain)},requiredSeventhComputePort(host.system.optional('featureTransformCompute')),host.signal);host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.dispose());}
export const route=suiteRoute('feat-artifacts',schemas,services.domain,featRouteMetadata['artifacts']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
