/** 场景编排的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-scenarios',name:"场景编排",description:"时钟跳变、暂停、重启和规则修订时间表",category:'development',experimental:true,requires:[pin('schedlab-spaces'),pin('schedlab-clocks'),pin('schedlab-rules'),pin('schedlab-policies'),pin('schedlab-workloads')],systemDependencies:['scheduleModelCompute'],services:['schedlabScenarios'],contributes:{http:schedlabHttp('scenarios'),routes:schedlabRoutes('scenarios')}});
