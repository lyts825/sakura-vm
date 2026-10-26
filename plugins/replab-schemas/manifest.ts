/** 数据模型的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-schemas',name:"数据模型",description:"有限键、值类型、删除标记和字段约束",category:'development',experimental:true,requires:[pin('replab-spaces')],systemDependencies:['replicaModelCompute'],services:['replabSchemas'],contributes:{http:replabHttp('schemas'),routes:replabRoutes('schemas')}});
