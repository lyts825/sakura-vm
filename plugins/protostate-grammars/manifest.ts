/** 消息语法的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-grammars',name:"消息语法",description:"固定字段、长度、枚举和有限重复规则",category:'development',experimental:true,requires:[pin('protostate-spaces')],systemDependencies:['protocolScenarioSessions'],services:['protostateGrammars'],contributes:{http:protostateHttp('grammars'),routes:protostateRoutes('grammars')}});
