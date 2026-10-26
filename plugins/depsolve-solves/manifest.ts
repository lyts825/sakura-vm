/** 求解运行的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-solves',name:"求解运行",description:"固定模型、搜索轨迹、候选赋值和任务回执",category:'development',experimental:true,requires:[pin('depsolve-spaces'),pin('depsolve-constraints'),pin('depsolve-candidates')],systemDependencies:['dependencyConstraintCompute'],services:['depsolveSolves'],contributes:{http:depsolveHttp('solves'),routes:depsolveRoutes('solves')}});
