/** 结果复核的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-annotations',name:"结果复核",description:"发现、证据引用、解释和人工意见",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-entities'),pin('graphdesk-edges'),pin('graphdesk-runs'),pin('graphdesk-comparisons')],systemDependencies:['relationGraphCompute'],services:['graphdeskAnnotations'],contributes:{http:graphdeskHttp('annotations'),routes:graphdeskRoutes('annotations')}});
