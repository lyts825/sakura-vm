/** 关系图交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-exchange',name:"关系图交接",description:"原图、投影、结果和说明的隔离交换",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-sources'),pin('graphdesk-entities'),pin('graphdesk-edges'),pin('graphdesk-projections'),pin('graphdesk-queries'),pin('graphdesk-algorithms'),pin('graphdesk-runs'),pin('graphdesk-comparisons'),pin('graphdesk-annotations'),pin('graphdesk-views'),pin('graphdesk-reports')],services:['graphdeskExchange'],contributes:{http:graphdeskHttp('exchange'),routes:graphdeskRoutes('exchange')}});
