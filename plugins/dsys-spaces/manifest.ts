/** 系统空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-spaces',name:"系统空间",description:"空间、模板及访问修订",category:'development',experimental:true,requires:[],systemDependencies:['designSystemCompile'],services:['dsysSpaces'],contributes:{http:dsysHttp('spaces'),routes:dsysRoutes('spaces')}});
