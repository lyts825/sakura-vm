/** 批次检查的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-runs',name:"批次检查",description:"固定规则与基线的执行意图和结果",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-sources'),pin('qualitydesk-partitions'),pin('qualitydesk-profiles'),pin('qualitydesk-rules'),pin('qualitydesk-baselines')],systemDependencies:['batchQualityCompute'],services:['qualitydeskRuns'],contributes:{http:qualitydeskHttp('runs'),routes:qualitydeskRoutes('runs')}});
