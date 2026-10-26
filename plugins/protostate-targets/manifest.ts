/** 目标制品的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-targets',name:"目标制品",description:"用户提供的固定服务字节、启动档案与端口声明",category:'development',experimental:true,requires:[pin('protostate-spaces')],systemDependencies:['protocolScenarioSessions'],services:['protostateTargets'],contributes:{http:protostateHttp('targets'),routes:protostateRoutes('targets')}});
