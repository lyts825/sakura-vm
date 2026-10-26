/** 双侧对账的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-reconciliation',name:"双侧对账",description:"键对齐、重复键、缺项及精确聚合差异",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-sources'),pin('qualitydesk-partitions'),pin('qualitydesk-rules')],systemDependencies:['batchQualityCompute'],services:['qualitydeskReconciliation'],contributes:{http:qualitydeskHttp('reconciliation'),routes:qualitydeskRoutes('reconciliation')}});
