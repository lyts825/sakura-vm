/** 模拟空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-spaces',name:"模拟空间",description:"空间、授权修订和额度根账本",category:'development',experimental:true,requires:[],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtserviceSpaces'],contributes:{http:virtserviceHttp('spaces'),routes:virtserviceRoutes('spaces')}});
