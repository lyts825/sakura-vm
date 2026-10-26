/** 内容检查的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-checks',name:"内容检查",description:"未定义变量、转义、长度、链接及语言缺项",category:'development',experimental:true,requires:[pin('ntpl-spaces'),pin('ntpl-variables'),pin('ntpl-channels'),pin('ntpl-templates'),pin('ntpl-locales'),pin('ntpl-assets'),pin('ntpl-renders'),pin('ntpl-inboxes')],systemDependencies:['notificationRenderCompute'],services:['ntplChecks'],contributes:{http:ntplHttp('checks'),routes:ntplRoutes('checks')}});
