/** 匹配复核的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-evaluations',name:"匹配复核",description:"固定标注对、抽样范围和匹配指标",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-candidates'),pin('entitydesk-clusters'),pin('entitydesk-decisions')],systemDependencies:['entityMatchingCompute'],services:['entitydeskEvaluations'],contributes:{http:entitydeskHttp('evaluations'),routes:entitydeskRoutes('evaluations')}});
