/** 地理材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-sources',name:"地理材料",description:"原文件、来源许可和字段档案",category:'development',experimental:true,requires:[pin('geodesk-spaces')],systemDependencies:['vectorGeometryCompute'],services:['geodeskSources'],contributes:{http:geodeskHttp('sources'),routes:geodeskRoutes('sources')}});
