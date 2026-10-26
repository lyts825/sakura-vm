/** 空间计算的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-runs',name:"空间计算",description:"固定工具任务、派生图层和逐要素错误",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-crs'),pin('geodesk-validation'),pin('geodesk-layers'),pin('geodesk-operations'),pin('geodesk-joins'),pin('geodesk-indexes')],systemDependencies:['vectorGeometryCompute'],services:['geodeskRuns'],contributes:{http:geodeskHttp('runs'),routes:geodeskRoutes('runs')}});
