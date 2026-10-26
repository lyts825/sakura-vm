/** 地理计量的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-measures',name:"地理计量",description:"距离、长度、面积及分组汇总",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-crs'),pin('geodesk-layers'),pin('geodesk-runs')],systemDependencies:['vectorGeometryCompute'],services:['geodeskMeasures'],contributes:{http:geodeskHttp('measures'),routes:geodeskRoutes('measures')}});
