/** 联动规则的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-transitions',name:"联动规则",description:"局部状态变化、固定内部调用及联合提交次序",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-contracts'),pin('virtservice-matchers'),pin('virtservice-states')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtserviceTransitions'],contributes:{http:virtserviceHttp('transitions'),routes:virtserviceRoutes('transitions')}});
