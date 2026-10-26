/** 地图样式的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-styles',name:"地图样式",description:"分类色、标注、图例和显示精度",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-layers'),pin('geodesk-measures')],systemDependencies:['vectorGeometryCompute'],services:['geodeskStyles'],contributes:{http:geodeskHttp('styles'),routes:geodeskRoutes('styles')}});
