/** 条件约束的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-guards',name:"条件约束",description:"字段比较、变量绑定和有界定时条件",category:'development',experimental:true,requires:[pin('protostate-spaces'),pin('protostate-grammars'),pin('protostate-machines')],systemDependencies:['protocolScenarioSessions'],services:['protostateGuards'],contributes:{http:protostateHttp('guards'),routes:protostateRoutes('guards')}});
