/** 版式样例的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-layouts',name:"版式样例",description:"布局容器、断点及固定组件组合",category:'development',experimental:true,requires:[pin('dsys-spaces'),pin('dsys-themes'),pin('dsys-components'),pin('dsys-states')],systemDependencies:['designSystemCompile'],services:['dsysLayouts'],contributes:{http:dsysHttp('layouts'),routes:dsysRoutes('layouts')}});
