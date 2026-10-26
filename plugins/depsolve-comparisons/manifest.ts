/** 方案对比的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-comparisons',name:"方案对比",description:"候选版本、直接/传递变化和排除原因",category:'development',experimental:true,requires:[pin('depsolve-spaces'),pin('depsolve-catalogs'),pin('depsolve-solves'),pin('depsolve-proofs')],systemDependencies:['dependencyConstraintCompute'],services:['depsolveComparisons'],contributes:{http:depsolveHttp('comparisons'),routes:depsolveRoutes('comparisons')}});
