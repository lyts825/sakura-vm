/** 图投影的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-projections',name:"图投影",description:"节点筛选、边聚合、方向和时间截面",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-entities'),pin('graphdesk-edges')],systemDependencies:['relationGraphCompute'],services:['graphdeskProjections'],contributes:{http:graphdeskHttp('projections'),routes:graphdeskRoutes('projections')}});
