/** 语义判断的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-checks',name:"语义判断",description:"漏发、重复、顺序、延迟和退避比较",category:'development',experimental:true,requires:[pin('schedlab-spaces'),pin('schedlab-rules'),pin('schedlab-policies'),pin('schedlab-scenarios'),pin('schedlab-observations')],systemDependencies:['scheduleModelCompute'],services:['schedlabChecks'],contributes:{http:schedlabHttp('checks'),routes:schedlabRoutes('checks')}});
