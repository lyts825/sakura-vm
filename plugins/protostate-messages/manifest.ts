/** 消息材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-messages',name:"消息材料",description:"原始字节、字段解析和固定消息样本",category:'development',experimental:true,requires:[pin('protostate-spaces'),pin('protostate-grammars')],systemDependencies:['protocolScenarioSessions'],services:['protostateMessages'],contributes:{http:protostateHttp('messages'),routes:protostateRoutes('messages')}});
