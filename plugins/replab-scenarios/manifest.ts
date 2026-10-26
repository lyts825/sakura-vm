/** 实验编排的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-scenarios',name:"实验编排",description:"固定事件计划、交付边界及待证性质",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-replicas'),pin('replab-operations'),pin('replab-clocks'),pin('replab-channels'),pin('replab-policies')],systemDependencies:['replicaModelCompute'],services:['replabScenarios'],contributes:{http:replabHttp('scenarios'),routes:replabRoutes('scenarios')}});
