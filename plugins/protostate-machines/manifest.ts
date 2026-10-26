/** 状态模型的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-machines',name:"状态模型",description:"起始/结束状态、转换及允许消息集合",category:'development',experimental:true,requires:[pin('protostate-spaces'),pin('protostate-grammars')],systemDependencies:['protocolScenarioSessions'],services:['protostateMachines'],contributes:{http:protostateHttp('machines'),routes:protostateRoutes('machines')}});
