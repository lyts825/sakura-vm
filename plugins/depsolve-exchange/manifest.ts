/** 求解交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-exchange',name:"求解交接",description:"元数据、约束、锁定计划和报告的隔离交换",category:'development',experimental:true,requires:[pin('depsolve-spaces'),pin('depsolve-catalogs'),pin('depsolve-roots'),pin('depsolve-platforms'),pin('depsolve-constraints'),pin('depsolve-candidates'),pin('depsolve-solves'),pin('depsolve-proofs'),pin('depsolve-comparisons'),pin('depsolve-locks'),pin('depsolve-reports')],services:['depsolveExchange'],contributes:{http:depsolveHttp('exchange'),routes:depsolveRoutes('exchange')}});
