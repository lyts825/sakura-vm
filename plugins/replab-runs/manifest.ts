/** 有限重放的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-runs',name:"有限重放",description:"原始事件轨迹、逐副本快照和执行回执",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-schemas'),pin('replab-replicas'),pin('replab-operations'),pin('replab-clocks'),pin('replab-channels'),pin('replab-policies'),pin('replab-scenarios')],systemDependencies:['replicaModelCompute'],services:['replabRuns'],contributes:{http:replabHttp('runs'),routes:replabRoutes('runs')}});
