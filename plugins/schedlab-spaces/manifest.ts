/** 调度空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-spaces',name:"调度空间",description:"空间、授权修订和额度根账本",category:'development',experimental:true,requires:[],systemDependencies:['scheduleModelCompute'],services:['schedlabSpaces'],contributes:{http:schedlabHttp('spaces'),routes:schedlabRoutes('spaces')}});
