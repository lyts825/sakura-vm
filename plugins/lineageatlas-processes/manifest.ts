/** 处理步骤的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-processes',name:"处理步骤",description:"作业定义、固定输入输出和时段",category:'development',experimental:true,requires:[pin('lineageatlas-spaces'),pin('lineageatlas-assets'),pin('lineageatlas-mappings')],systemDependencies:['lineageGraphCompute'],services:['lineageatlasProcesses'],contributes:{http:lineageatlasHttp('processes'),routes:lineageatlasRoutes('processes')}});
