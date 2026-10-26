/** 时间比较的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-comparisons',name:"时间比较",description:"规则版本差异、窗口修正和缺口",category:'development',experimental:true,requires:[pin('temporaldesk-spaces'),pin('temporaldesk-runs'),pin('temporaldesk-windows'),pin('temporaldesk-latepolicy')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskComparisons'],contributes:{http:temporaldeskHttp('comparisons'),routes:temporaldeskRoutes('comparisons')}});
