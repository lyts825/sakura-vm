/** 虚拟推进的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-simulations',name:"虚拟推进",description:"虚拟事件队列、触发原因与模拟回执",category:'development',experimental:true,requires:[pin('schedlab-spaces'),pin('schedlab-calendars'),pin('schedlab-clocks'),pin('schedlab-rules'),pin('schedlab-policies'),pin('schedlab-workloads'),pin('schedlab-scenarios')],systemDependencies:['scheduleModelCompute'],services:['schedlabSimulations'],contributes:{http:schedlabHttp('simulations'),routes:schedlabRoutes('simulations')}});
