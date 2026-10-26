/** 图版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-graphs',name:"图版本",description:"固定节点边、有效期和完整性缺项",category:'development',experimental:true,requires:[pin('lineageatlas-spaces'),pin('lineageatlas-assets'),pin('lineageatlas-mappings'),pin('lineageatlas-processes'),pin('lineageatlas-assertions')],systemDependencies:['lineageGraphCompute'],services:['lineageatlasGraphs'],contributes:{http:lineageatlasHttp('graphs'),routes:lineageatlasRoutes('graphs')}});
