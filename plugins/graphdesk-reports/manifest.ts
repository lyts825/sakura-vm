/** 图分析档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-reports',name:"图分析档案",description:"固定投影、算法、结果、解释和图视图",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-projections'),pin('graphdesk-runs'),pin('graphdesk-comparisons'),pin('graphdesk-annotations'),pin('graphdesk-views')],systemDependencies:['relationGraphCompute'],services:['graphdeskReports'],contributes:{http:graphdeskHttp('reports'),routes:graphdeskRoutes('reports')}});
