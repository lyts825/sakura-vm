/** 请求证据的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-traffic',name:"请求证据",description:"原请求序号、服务间因果关联和选定正文",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-contracts'),pin('virtservice-sessions')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtserviceTraffic'],contributes:{http:virtserviceHttp('traffic'),routes:virtserviceRoutes('traffic')}});
