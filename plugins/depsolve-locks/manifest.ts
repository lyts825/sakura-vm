/** 锁定计划的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-locks',name:"锁定计划",description:"中立精确版本集合、依赖边及固定输入摘要",category:'development',experimental:true,requires:[pin('depsolve-spaces'),pin('depsolve-catalogs'),pin('depsolve-roots'),pin('depsolve-platforms'),pin('depsolve-solves'),pin('depsolve-proofs'),pin('depsolve-comparisons')],systemDependencies:['dependencyConstraintCompute'],services:['depsolveLocks'],contributes:{http:depsolveHttp('locks'),routes:depsolveRoutes('locks')}});
