/** 时间对齐的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-alignment',name:"时间对齐",description:"时区消歧、单位转换及显式偏移规则",category:'development',experimental:true,requires:[pin('temporaldesk-spaces'),pin('temporaldesk-sources'),pin('temporaldesk-calendars'),pin('temporaldesk-semantics')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskAlignment'],contributes:{http:temporaldeskHttp('alignment'),routes:temporaldeskRoutes('alignment')}});
