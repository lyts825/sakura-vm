/** 对话场景的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {protostateRoutes,protostateHttp} from '../../shared/contracts/protostate-routes.generated.ts';
export const manifest=definePlugin({id:'protostate-scenarios',name:"对话场景",description:"请求序列、分片边界、关闭和期望分支",category:'development',experimental:true,requires:[pin('protostate-spaces'),pin('protostate-messages'),pin('protostate-machines'),pin('protostate-guards')],systemDependencies:['protocolScenarioSessions'],services:['protostateScenarios'],contributes:{http:protostateHttp('scenarios'),routes:protostateRoutes('scenarios')}});
