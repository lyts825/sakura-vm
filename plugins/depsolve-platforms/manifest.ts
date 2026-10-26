/** 目标档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-platforms',name:"目标档案",description:"操作系统、架构、运行版本及显式条件",category:'development',experimental:true,requires:[pin('depsolve-spaces')],systemDependencies:['dependencyConstraintCompute'],services:['depsolvePlatforms'],contributes:{http:depsolveHttp('platforms'),routes:depsolveRoutes('platforms')}});
