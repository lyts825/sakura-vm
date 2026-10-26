/** 坐标档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-crs',name:"坐标档案",description:"坐标参考、轴顺序、单位及变换版本",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-sources')],systemDependencies:['vectorGeometryCompute'],services:['geodeskCrs'],contributes:{http:geodeskHttp('crs'),routes:geodeskRoutes('crs')}});
