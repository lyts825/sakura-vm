/** 血缘档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-reports',name:"血缘档案",description:"图差异、调查范围和确认时点",category:'development',experimental:true,requires:[pin('lineageatlas-spaces'),pin('lineageatlas-graphs'),pin('lineageatlas-impacts'),pin('lineageatlas-investigations'),pin('lineageatlas-reviews')],systemDependencies:['lineageGraphCompute'],services:['lineageatlasReports'],contributes:{http:lineageatlasHttp('reports'),routes:lineageatlasRoutes('reports')}});
