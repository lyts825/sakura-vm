/** 异常处置的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-findings',name:"异常处置",description:"问题、归类、业务负责人和复查状态",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-runs')],systemDependencies:['batchQualityCompute'],services:['qualitydeskFindings'],contributes:{http:qualitydeskHttp('findings'),routes:qualitydeskRoutes('findings')}});
