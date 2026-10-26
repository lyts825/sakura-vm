/** 血缘交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-exchange',name:"血缘交接",description:"原目录、图版本与调查档案的隔离交换",category:'development',experimental:true,requires:[pin('lineageatlas-spaces'),pin('lineageatlas-catalogs'),pin('lineageatlas-assets'),pin('lineageatlas-mappings'),pin('lineageatlas-processes'),pin('lineageatlas-assertions'),pin('lineageatlas-graphs'),pin('lineageatlas-impacts'),pin('lineageatlas-investigations'),pin('lineageatlas-reviews'),pin('lineageatlas-reports')],services:['lineageatlasExchange'],contributes:{http:lineageatlasHttp('exchange'),routes:lineageatlasRoutes('exchange')}});
