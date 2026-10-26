/** 服务状态的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-states',name:"服务状态",description:"各服务初始键值、状态模式及重置基线",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-contracts'),pin('virtservice-payloads')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtserviceStates'],contributes:{http:virtserviceHttp('states'),routes:virtserviceRoutes('states')}});
