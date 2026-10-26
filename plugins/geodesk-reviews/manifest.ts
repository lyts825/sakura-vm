/** 地图复核的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-reviews',name:"地图复核",description:"修复选择、缺失区域和用途限制决定",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-validation'),pin('geodesk-layers'),pin('geodesk-runs'),pin('geodesk-measures'),pin('geodesk-styles')],systemDependencies:['vectorGeometryCompute'],services:['geodeskReviews'],contributes:{http:geodeskHttp('reviews'),routes:geodeskRoutes('reviews')}});
