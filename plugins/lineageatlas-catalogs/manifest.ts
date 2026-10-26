/** 来源目录的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-catalogs',name:"来源目录",description:"原始清单、命名空间和来源许可",category:'development',experimental:true,requires:[pin('lineageatlas-spaces')],systemDependencies:['lineageGraphCompute'],services:['lineageatlasCatalogs'],contributes:{http:lineageatlasHttp('catalogs'),routes:lineageatlasRoutes('catalogs')}});
