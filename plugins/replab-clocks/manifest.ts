/** 因果时钟的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-clocks',name:"因果时钟",description:"逻辑时钟、版本向量及墙钟偏差档案",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-replicas')],systemDependencies:['replicaModelCompute'],services:['replabClocks'],contributes:{http:replabHttp('clocks'),routes:replabRoutes('clocks')}});
