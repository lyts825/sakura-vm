/** 时间处理的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-runs',name:"时间处理",description:"对齐、窗口、区间计算和派生数据",category:'development',experimental:true,requires:[pin('temporaldesk-spaces'),pin('temporaldesk-sources'),pin('temporaldesk-calendars'),pin('temporaldesk-semantics'),pin('temporaldesk-alignment'),pin('temporaldesk-intervals'),pin('temporaldesk-windows'),pin('temporaldesk-latepolicy')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskRuns'],contributes:{http:temporaldeskHttp('runs'),routes:temporaldeskRoutes('runs')}});
