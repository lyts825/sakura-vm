/** 约束模型的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {depsolveRoutes,depsolveHttp} from '../../shared/contracts/depsolve-routes.generated.ts';
export const manifest=definePlugin({id:'depsolve-constraints',name:"约束模型",description:"版本域、冲突、同伴依赖和多实例策略",category:'development',experimental:true,requires:[pin('depsolve-spaces'),pin('depsolve-catalogs'),pin('depsolve-roots'),pin('depsolve-platforms')],systemDependencies:['dependencyConstraintCompute'],services:['depsolveConstraints'],contributes:{http:depsolveHttp('constraints'),routes:depsolveRoutes('constraints')}});
