/** 故障档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-faults',name:"故障档案",description:"指定服务/操作的延迟、错误与断连脚本",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-contracts'),pin('virtservice-matchers')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtserviceFaults'],contributes:{http:virtserviceHttp('faults'),routes:virtserviceRoutes('faults')}});
