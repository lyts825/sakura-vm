/** 触发策略的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-policies',name:"触发策略",description:"重叠、错过、重试和退避策略",category:'development',experimental:true,requires:[pin('schedlab-spaces')],systemDependencies:['scheduleModelCompute'],services:['schedlabPolicies'],contributes:{http:schedlabHttp('policies'),routes:schedlabRoutes('policies')}});
