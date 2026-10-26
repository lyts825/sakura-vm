/** 节点目录的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-entities',name:"节点目录",description:"稳定节点、类型、属性及别名",category:'development',experimental:true,requires:[pin('graphdesk-spaces'),pin('graphdesk-sources')],systemDependencies:['relationGraphCompute'],services:['graphdeskEntities'],contributes:{http:graphdeskHttp('entities'),routes:graphdeskRoutes('entities')}});
