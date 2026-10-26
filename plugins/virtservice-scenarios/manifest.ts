/** 消费者场景的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-scenarios',name:"消费者场景",description:"固定请求、跨服务期望、分支点与检查点要求",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-contracts'),pin('virtservice-payloads'),pin('virtservice-states'),pin('virtservice-transitions'),pin('virtservice-faults')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtserviceScenarios'],contributes:{http:virtserviceHttp('scenarios'),routes:virtserviceRoutes('scenarios')}});
