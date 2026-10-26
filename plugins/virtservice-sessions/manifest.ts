/** 环境会话的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-sessions',name:"环境会话",description:"原客户机、内部监听、联合检查点及分支回执",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-packages'),pin('virtservice-scenarios'),pin('projects')],systemDependencies:['multiServiceVirtualizationSessions','imageAssets'],services:['virtserviceSessions'],contributes:{http:virtserviceHttp('sessions'),routes:virtserviceRoutes('sessions')}});
