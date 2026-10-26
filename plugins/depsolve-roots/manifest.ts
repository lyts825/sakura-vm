/** 根需求的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-roots',name:"根需求",description:"直接需求、能力请求和替代候选",category:'development',experimental:true,requires:[pin('depsolve-spaces')],systemDependencies:['dependencyConstraintCompute'],services:['depsolveRoots'],contributes:{http:depsolveHttp('roots'),routes:depsolveRoutes('roots')}});
