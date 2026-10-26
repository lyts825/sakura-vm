/** 血缘证据的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-assertions',name:"血缘证据",description:"观察、外来声明、人工补录和相互冲突",category:'development',experimental:true,requires:[pin('lineageatlas-spaces'),pin('lineageatlas-catalogs'),pin('lineageatlas-assets'),pin('lineageatlas-mappings'),pin('lineageatlas-processes')],systemDependencies:['lineageGraphCompute'],services:['lineageatlasAssertions'],contributes:{http:lineageatlasHttp('assertions'),routes:lineageatlasRoutes('assertions')}});
