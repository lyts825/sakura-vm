/** 地理空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-spaces',name:"地理空间",description:"工作空间、授权和额度",category:'development',experimental:true,requires:[],systemDependencies:['vectorGeometryCompute'],services:['geodeskSpaces'],contributes:{http:geodeskHttp('spaces'),routes:geodeskRoutes('spaces')}});
