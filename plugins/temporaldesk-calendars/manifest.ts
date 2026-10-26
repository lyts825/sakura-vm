/** 日历版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-calendars',name:"日历版本",description:"时区资料、工作日历及业务日边界",category:'development',experimental:true,requires:[pin('temporaldesk-spaces')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskCalendars'],contributes:{http:temporaldeskHttp('calendars'),routes:temporaldeskRoutes('calendars')}});
