/** 图视图的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-views',name:"图视图",description:"布局种子、坐标、聚合和展示范围",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-projections'),pin('graphdesk-runs'),pin('graphdesk-annotations')],systemDependencies:['relationGraphCompute'],services:['graphdeskViews'],contributes:{http:graphdeskHttp('views'),routes:graphdeskRoutes('views')}});
