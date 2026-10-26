/** 协议运行的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-runs',name:"协议运行",description:"专属工具会话、原目标进程和逐连接回执",category:'development',experimental:true,requires:[pin('protostate-spaces'),pin('protostate-grammars'),pin('protostate-messages'),pin('protostate-machines'),pin('protostate-guards'),pin('protostate-scenarios'),pin('protostate-generators'),pin('protostate-targets'),pin('projects')],systemDependencies:['protocolScenarioSessions','imageAssets'],services:['protostateRuns'],contributes:{http:protostateHttp('runs'),routes:protostateRoutes('runs')}});
