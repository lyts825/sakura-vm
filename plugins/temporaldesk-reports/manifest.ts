/** 时间档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-reports',name:"时间档案",description:"处理版本、原值追溯和覆盖说明",category:'development',experimental:true,requires:[pin('temporaldesk-spaces'),pin('temporaldesk-runs'),pin('temporaldesk-comparisons'),pin('temporaldesk-reviews')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskReports'],contributes:{http:temporaldeskHttp('reports'),routes:temporaldeskRoutes('reports')}});
