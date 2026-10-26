/** 工坊交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-exchange',name:"工坊交接",description:"源码、开发档案和发行候选的隔离交换",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-sources'),pin('extforge-manifests'),pin('extforge-interfaces'),pin('extforge-toolchains'),pin('extforge-builds'),pin('extforge-inspections'),pin('extforge-cases'),pin('extforge-trials'),pin('extforge-signatures'),pin('extforge-bundles'),pin('extforge-reviews'),pin('extforge-reports')],services:['extforgeExchange'],contributes:{http:extforgeHttp('exchange'),routes:extforgeRoutes('exchange')}});
