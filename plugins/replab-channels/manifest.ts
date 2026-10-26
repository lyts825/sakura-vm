/** 传递模型的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-channels',name:"传递模型",description:"方向、断连、延迟、重复和重排计划",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-replicas')],systemDependencies:['replicaModelCompute'],services:['replabChannels'],contributes:{http:replabHttp('channels'),routes:replabRoutes('channels')}});
