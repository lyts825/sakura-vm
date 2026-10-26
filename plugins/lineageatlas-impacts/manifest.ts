/** 变更影响的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-impacts',name:"变更影响",description:"变更集、遍历范围、路径和停止边界",category:'development',experimental:true,requires:[pin('lineageatlas-spaces'),pin('lineageatlas-assets'),pin('lineageatlas-assertions'),pin('lineageatlas-graphs')],systemDependencies:['lineageGraphCompute'],services:['lineageatlasImpacts'],contributes:{http:lineageatlasHttp('impacts'),routes:lineageatlasRoutes('impacts')}});
