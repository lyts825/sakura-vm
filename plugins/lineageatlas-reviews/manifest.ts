/** 图复核的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-reviews',name:"图复核",description:"身份合并和影响结论的人工决定",category:'development',experimental:true,requires:[pin('lineageatlas-spaces'),pin('lineageatlas-assets'),pin('lineageatlas-graphs'),pin('lineageatlas-impacts'),pin('lineageatlas-investigations')],systemDependencies:['lineageGraphCompute'],services:['lineageatlasReviews'],contributes:{http:lineageatlasHttp('reviews'),routes:lineageatlasRoutes('reviews')}});
