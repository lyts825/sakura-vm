/** 字段映射的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-mappings',name:"字段映射",description:"源目标字段、变换类别与缺失声明",category:'development',experimental:true,requires:[pin('lineageatlas-spaces'),pin('lineageatlas-assets')],systemDependencies:['lineageGraphCompute'],services:['lineageatlasMappings'],contributes:{http:lineageatlasHttp('mappings'),routes:lineageatlasRoutes('mappings')}});
