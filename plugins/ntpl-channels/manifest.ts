/** 渠道档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-channels',name:"渠道档案",description:"站内、纯文本和受限邮件的长度/内容规则",category:'development',experimental:true,requires:[pin('ntpl-spaces')],systemDependencies:['notificationRenderCompute'],services:['ntplChannels'],contributes:{http:ntplHttp('channels'),routes:ntplRoutes('channels')}});
