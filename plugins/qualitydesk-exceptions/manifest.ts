/** 限定例外的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-exceptions',name:"限定例外",description:"问题适用范围、理由、批准时点和到期",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-rules'),pin('qualitydesk-runs'),pin('qualitydesk-findings'),pin('qualitydesk-reconciliation')],systemDependencies:['batchQualityCompute'],services:['qualitydeskExceptions'],contributes:{http:qualitydeskHttp('exceptions'),routes:qualitydeskRoutes('exceptions')}});
