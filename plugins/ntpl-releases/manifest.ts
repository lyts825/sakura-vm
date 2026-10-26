/** 模板版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-releases',name:"模板版本",description:"固定来源、覆盖、人工复核和接受记录",category:'development',experimental:true,requires:[pin('ntpl-spaces'),pin('ntpl-variables'),pin('ntpl-channels'),pin('ntpl-templates'),pin('ntpl-locales'),pin('ntpl-assets'),pin('ntpl-audiences'),pin('ntpl-rules'),pin('ntpl-renders'),pin('ntpl-inboxes'),pin('ntpl-checks')],systemDependencies:['notificationRenderCompute'],services:['ntplReleases'],contributes:{http:ntplHttp('releases'),routes:ntplRoutes('releases')}});
