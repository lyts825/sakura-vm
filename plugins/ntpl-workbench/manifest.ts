/** 通知工作台的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-workbench',name:"通知工作台",description:"模板编辑、渠道/语言矩阵和虚拟收件箱导航",category:'development',experimental:true,requires:[pin('ntpl-spaces'),pin('ntpl-variables'),pin('ntpl-channels'),pin('ntpl-templates'),pin('ntpl-locales'),pin('ntpl-assets'),pin('ntpl-audiences'),pin('ntpl-rules'),pin('ntpl-renders'),pin('ntpl-inboxes'),pin('ntpl-checks'),pin('ntpl-releases'),pin('ntpl-exchange')],systemDependencies:['notificationRenderCompute'],services:['ntplWorkbench'],contributes:{pages:['notification-template-studio'],http:ntplHttp('workbench'),routes:ntplRoutes('workbench')}});
