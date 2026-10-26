/** 关系空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {graphdeskRoutes,graphdeskHttp} from '../../shared/contracts/graphdesk-routes.generated.ts';
export const manifest=definePlugin({id:'graphdesk-spaces',name:"关系空间",description:"空间、授权和额度",category:'development',experimental:true,requires:[],systemDependencies:['relationGraphCompute'],services:['graphdeskSpaces'],contributes:{http:graphdeskHttp('spaces'),routes:graphdeskRoutes('spaces')}});
