/** 图层交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-exchange',name:"图层交接",description:"图层、坐标档案和地图报告交换",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-sources'),pin('geodesk-crs'),pin('geodesk-validation'),pin('geodesk-layers'),pin('geodesk-operations'),pin('geodesk-joins'),pin('geodesk-indexes'),pin('geodesk-runs'),pin('geodesk-measures'),pin('geodesk-styles'),pin('geodesk-reviews'),pin('geodesk-reports')],services:['geodeskExchange'],contributes:{http:geodeskHttp('exchange'),routes:geodeskRoutes('exchange')}});
