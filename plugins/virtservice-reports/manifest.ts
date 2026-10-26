/** 模拟报告的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-reports',name:"模拟报告",description:"环境版本、固定分支、判断和原资源核销索引",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-packages'),pin('virtservice-sessions'),pin('virtservice-traffic'),pin('virtservice-assertions')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtserviceReports'],contributes:{http:virtserviceHttp('reports'),routes:virtserviceRoutes('reports')}});
