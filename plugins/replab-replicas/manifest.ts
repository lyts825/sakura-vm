/** 副本定义的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-replicas',name:"副本定义",description:"副本标识、初始数据和持久游标模型",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-schemas')],systemDependencies:['replicaModelCompute'],services:['replabReplicas'],contributes:{http:replabHttp('replicas'),routes:replabRoutes('replicas')}});
