/** 工作负载的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-workloads',name:"工作负载",description:"固定任务时长、确定性失败点与幂等键模型",category:'development',experimental:true,requires:[pin('schedlab-spaces')],systemDependencies:['scheduleModelCompute'],services:['schedlabWorkloads'],contributes:{http:schedlabHttp('workloads'),routes:schedlabRoutes('workloads')}});
