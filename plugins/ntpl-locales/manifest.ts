/** 语言变体的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-locales',name:"语言变体",description:"语言、格式约定、回退顺序和变量覆盖",category:'development',experimental:true,requires:[pin('ntpl-spaces'),pin('ntpl-variables'),pin('ntpl-templates')],systemDependencies:['notificationRenderCompute'],services:['ntplLocales'],contributes:{http:ntplHttp('locales'),routes:ntplRoutes('locales')}});
