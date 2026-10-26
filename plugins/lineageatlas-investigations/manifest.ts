/** 调查记录的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-investigations',name:"调查记录",description:"未知边、冲突问题、业务确认和证据补充",category:'development',experimental:true,requires:[pin('lineageatlas-spaces'),pin('lineageatlas-assertions'),pin('lineageatlas-graphs'),pin('lineageatlas-impacts')],systemDependencies:['lineageGraphCompute'],services:['lineageatlasInvestigations'],contributes:{http:lineageatlasHttp('investigations'),routes:lineageatlasRoutes('investigations')}});
