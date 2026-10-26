/** 图材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-sources',name:"图材料",description:"节点边原表、字段档案和许可",category:'development',experimental:true,requires:[pin('graphdesk-spaces')],systemDependencies:['relationGraphCompute'],services:['graphdeskSources'],contributes:{http:graphdeskHttp('sources'),routes:graphdeskRoutes('sources')}});
