/** 结果核验的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-proofs',name:"结果核验",description:"逐约束复查、冲突子集与完备性标记",category:'development',experimental:true,requires:[pin('depsolve-spaces'),pin('depsolve-constraints'),pin('depsolve-candidates'),pin('depsolve-solves')],systemDependencies:['dependencyConstraintCompute'],services:['depsolveProofs'],contributes:{http:depsolveHttp('proofs'),routes:depsolveRoutes('proofs')}});
