/** 地理档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-reports',name:"地理档案",description:"输入输出、地图视图及计量依据",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-layers'),pin('geodesk-runs'),pin('geodesk-measures'),pin('geodesk-styles'),pin('geodesk-reviews')],systemDependencies:['vectorGeometryCompute'],services:['geodeskReports'],contributes:{http:geodeskHttp('reports'),routes:geodeskRoutes('reports')}});
