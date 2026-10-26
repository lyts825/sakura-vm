/** 质量档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-reports',name:"质量档案",description:"趋势、放行范围和原证据索引",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-profiles'),pin('qualitydesk-baselines'),pin('qualitydesk-runs'),pin('qualitydesk-findings'),pin('qualitydesk-reconciliation'),pin('qualitydesk-exceptions'),pin('qualitydesk-releases')],systemDependencies:['batchQualityCompute'],services:['qualitydeskReports'],contributes:{http:qualitydeskHttp('reports'),routes:qualitydeskRoutes('reports')}});
