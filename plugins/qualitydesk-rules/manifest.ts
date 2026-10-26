/** 门槛版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-rules',name:"门槛版本",description:"分区覆盖、分布偏移和跨批次门槛",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-partitions'),pin('qualitydesk-profiles')],systemDependencies:['batchQualityCompute'],services:['qualitydeskRules'],contributes:{http:qualitydeskHttp('rules'),routes:qualitydeskRoutes('rules')}});
