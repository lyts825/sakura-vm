/** 算法档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-algorithms',name:"算法档案",description:"连通分量、度数、最短路径和固定迭代",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-projections')],systemDependencies:['relationGraphCompute'],services:['graphdeskAlgorithms'],contributes:{http:graphdeskHttp('algorithms'),routes:graphdeskRoutes('algorithms')}});
