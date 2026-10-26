/** 匹配规则的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-matchers',name:"匹配规则",description:"方法、路径、字段条件及显式优先级",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-contracts')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtserviceMatchers'],contributes:{http:virtserviceHttp('matchers'),routes:virtserviceRoutes('matchers')}});
