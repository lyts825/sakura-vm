/** 几何操作的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-operations',name:"几何操作",description:"裁剪、相交、缓冲和变换定义",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-crs'),pin('geodesk-layers')],systemDependencies:['vectorGeometryCompute'],services:['geodeskOperations'],contributes:{http:geodeskHttp('operations'),routes:geodeskRoutes('operations')}});
