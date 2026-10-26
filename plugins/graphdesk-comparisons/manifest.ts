/** 结构比较的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-comparisons',name:"结构比较",description:"节点边差异、指标适用条件与变化",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-projections'),pin('graphdesk-runs')],systemDependencies:['relationGraphCompute'],services:['graphdeskComparisons'],contributes:{http:graphdeskHttp('comparisons'),routes:graphdeskRoutes('comparisons')}});
