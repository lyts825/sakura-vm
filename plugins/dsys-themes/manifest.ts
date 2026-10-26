/** 主题集合的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-themes',name:"主题集合",description:"主题继承、语义别名与覆盖规则",category:'development',experimental:true,requires:[pin('dsys-spaces'),pin('dsys-tokens')],systemDependencies:['designSystemCompile'],services:['dsysThemes'],contributes:{http:dsysHttp('themes'),routes:dsysRoutes('themes')}});
