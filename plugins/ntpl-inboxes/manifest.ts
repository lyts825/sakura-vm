/** 虚拟收件箱的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-inboxes',name:"虚拟收件箱",description:"本地模拟投递意图、去重记录及渲染引用",category:'development',experimental:true,requires:[pin('ntpl-spaces'),pin('ntpl-audiences'),pin('ntpl-rules'),pin('ntpl-renders')],systemDependencies:['notificationRenderCompute'],services:['ntplInboxes'],contributes:{http:ntplHttp('inboxes'),routes:ntplRoutes('inboxes')}});
