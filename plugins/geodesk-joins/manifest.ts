/** 空间连接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-joins',name:"空间连接",description:"包含、相交、最近邻及多匹配策略",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-crs'),pin('geodesk-layers')],systemDependencies:['vectorGeometryCompute'],services:['geodeskJoins'],contributes:{http:geodeskHttp('joins'),routes:geodeskRoutes('joins')}});
