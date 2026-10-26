/** 对话轨迹的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-traces',name:"对话轨迹",description:"双向字节、顺序、解析投影与丢失声明",category:'development',experimental:true,requires:[pin('protostate-spaces'),pin('protostate-grammars'),pin('protostate-runs')],systemDependencies:['protocolScenarioSessions'],services:['protostateTraces'],contributes:{http:protostateHttp('traces'),routes:protostateRoutes('traces')}});
