/** 固定渲染的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-renders',name:"固定渲染",description:"完整渲染计划、文本/HTML 字节及逐样例来源",category:'development',experimental:true,requires:[pin('ntpl-spaces'),pin('ntpl-variables'),pin('ntpl-channels'),pin('ntpl-templates'),pin('ntpl-locales'),pin('ntpl-assets'),pin('ntpl-audiences'),pin('ntpl-rules')],systemDependencies:['notificationRenderCompute'],services:['ntplRenders'],contributes:{http:ntplHttp('renders'),routes:ntplRoutes('renders')}});
