/** 窗口定义的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-windows',name:"窗口定义",description:"滚动、滑动、会话及重采样窗口",category:'development',experimental:true,requires:[pin('temporaldesk-spaces'),pin('temporaldesk-calendars'),pin('temporaldesk-semantics'),pin('temporaldesk-alignment')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskWindows'],contributes:{http:temporaldeskHttp('windows'),routes:temporaldeskRoutes('windows')}});
