/** 基线窗口的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-baselines',name:"基线窗口",description:"历史批次选择、排除原因及冻结统计",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-partitions'),pin('qualitydesk-profiles'),pin('qualitydesk-rules')],systemDependencies:['batchQualityCompute'],services:['qualitydeskBaselines'],contributes:{http:qualitydeskHttp('baselines'),routes:qualitydeskRoutes('baselines')}});
