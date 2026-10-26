/** 副本空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-spaces',name:"副本空间",description:"空间、授权修订及额度根账本",category:'development',experimental:true,requires:[],systemDependencies:['replicaModelCompute'],services:['replabSpaces'],contributes:{http:replabHttp('spaces'),routes:replabRoutes('spaces')}});
