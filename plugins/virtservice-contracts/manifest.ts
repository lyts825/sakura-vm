/** 服务目录的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-contracts',name:"服务目录",description:"服务身份、操作、请求与响应合同",category:'development',experimental:true,requires:[pin('virtservice-spaces')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtserviceContracts'],contributes:{http:virtserviceHttp('contracts'),routes:virtserviceRoutes('contracts')}});
