/** 求解空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-spaces',name:"求解空间",description:"空间、授权修订及额度根账本",category:'development',experimental:true,requires:[],systemDependencies:['dependencyConstraintCompute'],services:['depsolveSpaces'],contributes:{http:depsolveHttp('spaces'),routes:depsolveRoutes('spaces')}});
