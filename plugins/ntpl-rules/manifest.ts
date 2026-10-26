/** 内容选择的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-rules',name:"内容选择",description:"模板/语言/渠道选择及本地抑制规则",category:'development',experimental:true,requires:[pin('ntpl-spaces'),pin('ntpl-channels'),pin('ntpl-templates'),pin('ntpl-locales'),pin('ntpl-audiences')],systemDependencies:['notificationRenderCompute'],services:['ntplRules'],contributes:{http:ntplHttp('rules'),routes:ntplRoutes('rules')}});
