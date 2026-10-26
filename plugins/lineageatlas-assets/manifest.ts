/** 资产身份的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-assets',name:"资产身份",description:"系统、数据集、字段和身份别名",category:'development',experimental:true,requires:[pin('lineageatlas-spaces'),pin('lineageatlas-catalogs')],systemDependencies:['lineageGraphCompute'],services:['lineageatlasAssets'],contributes:{http:lineageatlasHttp('assets'),routes:lineageatlasRoutes('assets')}});
