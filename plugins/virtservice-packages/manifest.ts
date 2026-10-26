/** 环境版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-packages',name:"环境版本",description:"服务拓扑、端点槽位、完整定义和工具要求",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-contracts'),pin('virtservice-payloads'),pin('virtservice-matchers'),pin('virtservice-states'),pin('virtservice-transitions'),pin('virtservice-faults'),pin('virtservice-scenarios')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtservicePackages'],contributes:{http:virtserviceHttp('packages'),routes:virtserviceRoutes('packages')}});
