/** 血缘空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {lineageatlasRoutes,lineageatlasHttp} from '../../shared/contracts/lineageatlas-routes.generated.ts';
export const manifest=definePlugin({id:'lineageatlas-spaces',name:"血缘空间",description:"空间、授权和额度",category:'development',experimental:true,requires:[],systemDependencies:['lineageGraphCompute'],services:['lineageatlasSpaces'],contributes:{http:lineageatlasHttp('spaces'),routes:lineageatlasRoutes('spaces')}});
