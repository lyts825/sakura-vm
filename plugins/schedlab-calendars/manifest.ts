/** 日历集合的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-calendars',name:"日历集合",description:"工作日、排除日期和显式节假日材料",category:'development',experimental:true,requires:[pin('schedlab-spaces')],systemDependencies:['scheduleModelCompute'],services:['schedlabCalendars'],contributes:{http:schedlabHttp('calendars'),routes:schedlabRoutes('calendars')}});
