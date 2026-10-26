/** 区间规则的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-intervals',name:"区间规则",description:"开闭端点、重叠、间隙与有效期",category:'development',experimental:true,requires:[pin('temporaldesk-spaces'),pin('temporaldesk-semantics'),pin('temporaldesk-alignment')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskIntervals'],contributes:{http:temporaldeskHttp('intervals'),routes:temporaldeskRoutes('intervals')}});
