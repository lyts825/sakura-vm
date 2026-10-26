/** 状态矩阵的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-states',name:"状态矩阵",description:"组件状态、允许组合、触发语义与示例值",category:'development',experimental:true,requires:[pin('dsys-spaces'),pin('dsys-components')],systemDependencies:['designSystemCompile'],services:['dsysStates'],contributes:{http:dsysHttp('states'),routes:dsysRoutes('states')}});
