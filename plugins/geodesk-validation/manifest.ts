/** 几何检查的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-validation',name:"几何检查",description:"无效坐标、自交、空几何和修复建议",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-sources'),pin('geodesk-crs')],systemDependencies:['vectorGeometryCompute'],services:['geodeskValidation'],contributes:{http:geodeskHttp('validation'),routes:geodeskRoutes('validation')}});
