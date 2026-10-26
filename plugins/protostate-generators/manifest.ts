/** 有界变体的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-generators',name:"有界变体",description:"固定种子、边界变值、重排及覆盖计划",category:'development',experimental:true,requires:[pin('protostate-spaces'),pin('protostate-grammars'),pin('protostate-messages'),pin('protostate-scenarios')],systemDependencies:['protocolScenarioSessions'],services:['protostateGenerators'],contributes:{http:protostateHttp('generators'),routes:protostateRoutes('generators')}});
