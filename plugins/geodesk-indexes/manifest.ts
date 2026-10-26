/** 空间索引的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {geodeskRoutes,geodeskHttp} from '../../shared/contracts/geodesk-routes.generated.ts';
export const manifest=definePlugin({id:'geodesk-indexes',name:"空间索引",description:"图层固定版本的索引及覆盖账本",category:'development',experimental:true,requires:[pin('geodesk-spaces'),pin('geodesk-layers')],systemDependencies:['vectorGeometryCompute'],services:['geodeskIndexes'],contributes:{http:geodeskHttp('indexes'),routes:geodeskRoutes('indexes')}});
