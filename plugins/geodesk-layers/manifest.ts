/** 图层版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-layers',name:"图层版本",description:"固定要素、属性、范围和父版本",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-sources'),pin('geodesk-crs'),pin('geodesk-validation')],systemDependencies:['vectorGeometryCompute'],services:['geodeskLayers'],contributes:{http:geodeskHttp('layers'),routes:geodeskRoutes('layers')}});
