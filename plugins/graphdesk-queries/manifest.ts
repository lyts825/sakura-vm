/** 路径查询的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-queries',name:"路径查询",description:"有限关系模式、起终点和遍历界限",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-entities'),pin('graphdesk-edges'),pin('graphdesk-projections')],systemDependencies:['relationGraphCompute'],services:['graphdeskQueries'],contributes:{http:graphdeskHttp('queries'),routes:graphdeskRoutes('queries')}});
