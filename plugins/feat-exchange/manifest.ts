/** 特征交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-exchange',name:"特征交接",description:"有界封套、隔离接收与本地 ID 映射",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-sources'),pin('feat-schemas'),pin('feat-partitions'),pin('feat-transforms'),pin('feat-joins'),pin('feat-windows'),pin('feat-fits'),pin('feat-selections'),pin('feat-runs'),pin('feat-checks'),pin('feat-artifacts'),pin('feat-reviews')],services:['featExchange'],contributes:{http:featHttp('exchange'),routes:featRoutes('exchange')}});
