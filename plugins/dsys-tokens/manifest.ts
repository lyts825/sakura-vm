/** 设计变量的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-tokens',name:"设计变量",description:"类型化颜色、间距、圆角、层级及引用",category:'development',experimental:true,requires:[pin('dsys-spaces')],systemDependencies:['designSystemCompile'],services:['dsysTokens'],contributes:{http:dsysHttp('tokens'),routes:dsysRoutes('tokens')}});
