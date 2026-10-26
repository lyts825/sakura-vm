/** 同步报告的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-reports',name:"同步报告",description:"模型范围、固定历史、判断及人工说明",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-replicas'),pin('replab-clocks'),pin('replab-channels'),pin('replab-policies'),pin('replab-scenarios'),pin('replab-runs'),pin('replab-conflicts'),pin('replab-judgments')],systemDependencies:['replicaModelCompute'],services:['replabReports'],contributes:{http:replabHttp('reports'),routes:replabRoutes('reports')}});
