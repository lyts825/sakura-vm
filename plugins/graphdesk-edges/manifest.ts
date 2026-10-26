/** 关系目录的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-edges',name:"关系目录",description:"有向性、多重边、权重与边证据",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-sources'),pin('graphdesk-entities')],systemDependencies:['relationGraphCompute'],services:['graphdeskEdges'],contributes:{http:graphdeskHttp('edges'),routes:graphdeskRoutes('edges')}});
