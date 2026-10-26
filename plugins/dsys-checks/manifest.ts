/** 系统检查的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-checks',name:"系统检查",description:"引用完整性、主题覆盖、对比度及静态尺寸约束",category:'development',experimental:true,requires:[pin('dsys-spaces'),pin('dsys-tokens'),pin('dsys-themes'),pin('dsys-typography'),pin('dsys-icons'),pin('dsys-components'),pin('dsys-states'),pin('dsys-layouts')],systemDependencies:['designSystemCompile'],services:['dsysChecks'],contributes:{http:dsysHttp('checks'),routes:dsysRoutes('checks')}});
