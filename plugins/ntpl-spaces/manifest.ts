/** 通知空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-spaces',name:"通知空间",description:"空间、模板、额度和访问修订",category:'development',experimental:true,requires:[],systemDependencies:['notificationRenderCompute'],services:['ntplSpaces'],contributes:{http:ntplHttp('spaces'),routes:ntplRoutes('spaces')}});
