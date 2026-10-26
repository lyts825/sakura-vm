/** 性质判断的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-properties',name:"性质判断",description:"状态合法性、响应约定和终止性质",category:'development',experimental:true,requires:[pin('protostate-spaces'),pin('protostate-machines'),pin('protostate-guards'),pin('protostate-scenarios'),pin('protostate-runs'),pin('protostate-traces')],systemDependencies:['protocolScenarioSessions'],services:['protostateProperties'],contributes:{http:protostateHttp('properties'),routes:protostateRoutes('properties')}});
