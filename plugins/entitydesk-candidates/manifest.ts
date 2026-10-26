/** 候选对的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-candidates',name:"候选对",description:"比较任务、逐字段分数和缺失项",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-sources'),pin('entitydesk-normalization'),pin('entitydesk-blocks'),pin('entitydesk-comparators')],systemDependencies:['entityMatchingCompute'],services:['entitydeskCandidates'],contributes:{http:entitydeskHttp('candidates'),routes:entitydeskRoutes('candidates')}});
