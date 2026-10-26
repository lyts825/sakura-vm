/** 触发观察的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-observations',name:"触发观察",description:"原始触发流、序号、丢失声明与时间换算",category:'development',experimental:true,requires:[pin('schedlab-spaces'),pin('schedlab-clocks'),pin('schedlab-simulations'),pin('schedlab-harness')],systemDependencies:['scheduleModelCompute'],services:['schedlabObservations'],contributes:{http:schedlabHttp('observations'),routes:schedlabRoutes('observations')}});
