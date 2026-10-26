/** 固定调度器的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-harness',name:"固定调度器",description:"专属客户机工具会话、真实时钟探针与资源票据",category:'development',experimental:true,requires:[pin('schedlab-spaces'),pin('schedlab-rules'),pin('schedlab-policies'),pin('schedlab-workloads'),pin('schedlab-scenarios'),pin('projects')],systemDependencies:['scheduleModelCompute','schedulerProbeSessions','imageAssets'],services:['schedlabHarness'],contributes:{http:schedlabHttp('harness'),routes:schedlabRoutes('harness')}});
