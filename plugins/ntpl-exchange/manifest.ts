/** 通知交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ntplRoutes,ntplHttp} from '../../shared/contracts/ntpl-routes.generated.ts';
export const manifest=definePlugin({id:'ntpl-exchange',name:"通知交接",description:"模板、资产和选定模拟证据的封套",category:'development',experimental:true,requires:[pin('ntpl-spaces'),pin('ntpl-variables'),pin('ntpl-channels'),pin('ntpl-templates'),pin('ntpl-locales'),pin('ntpl-assets'),pin('ntpl-audiences'),pin('ntpl-rules'),pin('ntpl-renders'),pin('ntpl-inboxes'),pin('ntpl-checks'),pin('ntpl-releases')],services:['ntplExchange'],contributes:{http:ntplHttp('exchange'),routes:ntplRoutes('exchange')}});
