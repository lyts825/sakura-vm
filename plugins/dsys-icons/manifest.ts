/** 图标资源的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-icons',name:"图标资源",description:"受限 SVG 字节、命名、许可和可见范围",category:'development',experimental:true,requires:[pin('dsys-spaces')],systemDependencies:['designSystemCompile'],services:['dsysIcons'],contributes:{http:dsysHttp('icons'),routes:dsysRoutes('icons')}});
