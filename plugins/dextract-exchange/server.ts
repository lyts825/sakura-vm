/** 提取交接：绑定本插件元数据、直接提供者和固定计算。 */
import type {PluginContext,PluginRoute} from '../../server/plugin-api.ts';
import {suiteAuthorize,suiteService,suiteRoute} from '../../server/suite-http.ts';
import {DextractExchange} from '../../server/seventh-domains.generated.ts';
import {SeventhComputePort} from '../../server/seventh-compute.ts';
import {seventhSchemas} from '../../shared/contracts/seventh-http.ts';
import {dextractRouteMetadata} from '../../shared/contracts/dextract-routes.generated.ts';
import {services} from './services.ts';
import {services as peer0} from '../dextract-spaces/services.ts';
import {services as peer1} from '../dextract-sources/services.ts';
import {services as peer2} from '../dextract-pages/services.ts';
import {services as peer3} from '../dextract-layouts/services.ts';
import {services as peer4} from '../dextract-ocr/services.ts';
import {services as peer5} from '../dextract-tables/services.ts';
import {services as peer6} from '../dextract-schemas/services.ts';
import {services as peer7} from '../dextract-fields/services.ts';
import {services as peer8} from '../dextract-checks/services.ts';
import {services as peer9} from '../dextract-corrections/services.ts';
import {services as peer10} from '../dextract-datasets/services.ts';
import {services as peer11} from '../dextract-reviews/services.ts';
export {manifest} from './manifest.ts';
const schemas=seventhSchemas('dextract-exchange');
export async function activate(host:PluginContext){const service=new DextractExchange('document-extraction-studio',host.capabilities.metadata.reference('state',()=>null),host.capabilities.metadata.reference('blobs',()=>null),host.capabilities.metadata.reference('uploads',()=>null),suiteAuthorize(host),host.use(peer0.domain),{'dextract-spaces':host.use(peer0.domain),'dextract-sources':host.use(peer1.domain),'dextract-pages':host.use(peer2.domain),'dextract-layouts':host.use(peer3.domain),'dextract-ocr':host.use(peer4.domain),'dextract-tables':host.use(peer5.domain),'dextract-schemas':host.use(peer6.domain),'dextract-fields':host.use(peer7.domain),'dextract-checks':host.use(peer8.domain),'dextract-corrections':host.use(peer9.domain),'dextract-datasets':host.use(peer10.domain),'dextract-reviews':host.use(peer11.domain)},{'dextract-sources':host.use(peer1.domain)});host.provide(services.domain,suiteService(schemas,service));host.onDispose(()=>service.close());}
export const route=suiteRoute('dextract-exchange',schemas,services.domain,dextractRouteMetadata['exchange']);
export const httpHandlers:Record<string,PluginRoute>=Object.fromEntries(Object.keys(schemas).map(id=>[id,route]));
export const responseContracts=Object.fromEntries(Object.entries(schemas).map(([id,{response}])=>[id,{kind:'json' as const,statuses:[200],schema:response}]));
