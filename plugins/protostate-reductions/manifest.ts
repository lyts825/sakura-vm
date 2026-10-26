/** 失败缩减的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-reductions',name:"失败缩减",description:"固定失败判据、候选序列及重复观察",category:'development',experimental:true,requires:[pin('protostate-spaces'),pin('protostate-scenarios'),pin('protostate-generators'),pin('protostate-targets'),pin('protostate-runs'),pin('protostate-traces'),pin('protostate-properties')],systemDependencies:['protocolScenarioSessions'],services:['protostateReductions'],contributes:{http:protostateHttp('reductions'),routes:protostateRoutes('reductions')}});
