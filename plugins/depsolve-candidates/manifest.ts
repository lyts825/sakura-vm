/** 候选策略的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-candidates',name:"候选策略",description:"旧锁偏好、更新范围和确定性排序规则",category:'development',experimental:true,requires:[pin('depsolve-spaces'),pin('depsolve-catalogs'),pin('depsolve-roots'),pin('depsolve-platforms')],systemDependencies:['dependencyConstraintCompute'],services:['depsolveCandidates'],contributes:{http:depsolveHttp('candidates'),routes:depsolveRoutes('candidates')}});
