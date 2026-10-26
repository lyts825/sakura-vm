/** 时间语义的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-semantics',name:"时间语义",description:"事件时间、记录时间、精度和不确定区间",category:'development',experimental:true,requires:[pin('temporaldesk-spaces'),pin('temporaldesk-sources'),pin('temporaldesk-calendars')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskSemantics'],contributes:{http:temporaldeskHttp('semantics'),routes:temporaldeskRoutes('semantics')}});
