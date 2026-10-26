/** 图计算的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-runs',name:"图计算",description:"固定图任务、结果表和收敛记录",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-projections'),pin('graphdesk-queries'),pin('graphdesk-algorithms')],systemDependencies:['relationGraphCompute'],services:['graphdeskRuns'],contributes:{http:graphdeskHttp('runs'),routes:graphdeskRoutes('runs')}});
