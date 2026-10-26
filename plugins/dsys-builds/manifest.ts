/** 产物编译的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-builds',name:"产物编译",description:"固定编译计划、变量/CSS 字节及输出清单",category:'development',experimental:true,requires:[pin('dsys-spaces'),pin('dsys-tokens'),pin('dsys-themes'),pin('dsys-typography'),pin('dsys-icons'),pin('dsys-components'),pin('dsys-states'),pin('dsys-layouts'),pin('dsys-checks')],systemDependencies:['designSystemCompile'],services:['dsysBuilds'],contributes:{http:dsysHttp('builds'),routes:dsysRoutes('builds')}});
