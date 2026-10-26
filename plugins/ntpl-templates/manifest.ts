/** 内容模板的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-templates',name:"内容模板",description:"标题、正文、片段及有限条件语法",category:'development',experimental:true,requires:[pin('ntpl-spaces'),pin('ntpl-variables'),pin('ntpl-channels')],systemDependencies:['notificationRenderCompute'],services:['ntplTemplates'],contributes:{http:ntplHttp('templates'),routes:ntplRoutes('templates')}});
