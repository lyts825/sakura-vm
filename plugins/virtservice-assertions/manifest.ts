/** 场景判断的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {virtserviceRoutes,virtserviceHttp} from '../../shared/contracts/virtservice-routes.generated.ts';
export const manifest=definePlugin({id:'virtservice-assertions',name:"场景判断",description:"合同匹配、联合状态、分支差异及覆盖",category:'development',experimental:true,requires:[pin('virtservice-spaces'),pin('virtservice-contracts'),pin('virtservice-scenarios'),pin('virtservice-packages'),pin('virtservice-sessions'),pin('virtservice-traffic')],systemDependencies:['multiServiceVirtualizationSessions'],services:['virtserviceAssertions'],contributes:{http:virtserviceHttp('assertions'),routes:virtserviceRoutes('assertions')}});
