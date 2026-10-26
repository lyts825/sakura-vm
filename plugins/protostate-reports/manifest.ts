/** 协议报告的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-reports',name:"协议报告",description:"规格、覆盖、反例、人工说明及核销证据",category:'development',experimental:true,requires:[pin('protostate-spaces'),pin('protostate-grammars'),pin('protostate-machines'),pin('protostate-scenarios'),pin('protostate-runs'),pin('protostate-traces'),pin('protostate-properties'),pin('protostate-reductions')],systemDependencies:['protocolScenarioSessions'],services:['protostateReports'],contributes:{http:protostateHttp('reports'),routes:protostateRoutes('reports')}});
