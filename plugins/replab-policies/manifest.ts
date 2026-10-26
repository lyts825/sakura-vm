/** 合并策略的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-policies',name:"合并策略",description:"明确规则、相同时间决胜和墓碑保留条件",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-schemas'),pin('replab-clocks')],systemDependencies:['replicaModelCompute'],services:['replabPolicies'],contributes:{http:replabHttp('policies'),routes:replabRoutes('policies')}});
