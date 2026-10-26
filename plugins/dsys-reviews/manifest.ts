/** 版本复核的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dsysRoutes,dsysHttp} from '../../shared/contracts/dsys-routes.generated.ts';
export const manifest=definePlugin({id:'dsys-reviews',name:"版本复核",description:"版本差异、例外、接受与不可变发布记录",category:'development',experimental:true,requires:[pin('dsys-spaces'),pin('dsys-checks'),pin('dsys-builds')],systemDependencies:['designSystemCompile'],services:['dsysReviews'],contributes:{http:dsysHttp('reviews'),routes:dsysRoutes('reviews')}});
