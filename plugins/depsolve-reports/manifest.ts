/** 求解报告的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-reports',name:"求解报告",description:"决策说明、冲突、范围和人工接受记录",category:'development',experimental:true,requires:[pin('depsolve-spaces'),pin('depsolve-constraints'),pin('depsolve-solves'),pin('depsolve-proofs'),pin('depsolve-comparisons'),pin('depsolve-locks')],systemDependencies:['dependencyConstraintCompute'],services:['depsolveReports'],contributes:{http:depsolveHttp('reports'),routes:depsolveRoutes('reports')}});
