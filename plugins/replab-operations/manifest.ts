/** 操作历史的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-operations',name:"操作历史",description:"固定写入、删除、增量和原始操作身份",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-schemas'),pin('replab-replicas')],systemDependencies:['replicaModelCompute'],services:['replabOperations'],contributes:{http:replabHttp('operations'),routes:replabRoutes('operations')}});
