/** 合成收件人的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-audiences',name:"合成收件人",description:"明示为合成的成员、变量、偏好和边界样例",category:'development',experimental:true,requires:[pin('ntpl-spaces'),pin('ntpl-variables'),pin('ntpl-locales')],systemDependencies:['notificationRenderCompute'],services:['ntplAudiences'],contributes:{http:ntplHttp('audiences'),routes:ntplRoutes('audiences')}});
