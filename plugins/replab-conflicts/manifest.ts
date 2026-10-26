/** 冲突解释的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-conflicts',name:"冲突解释",description:"并发写关系、规则选择与人工裁决候选",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-operations'),pin('replab-clocks'),pin('replab-policies'),pin('replab-runs')],systemDependencies:['replicaModelCompute'],services:['replabConflicts'],contributes:{http:replabHttp('conflicts'),routes:replabRoutes('conflicts')}});
