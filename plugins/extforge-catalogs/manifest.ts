/** 目录预演的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-catalogs',name:"目录预演",description:"多候选目录、版本碰撞和同源路径检查",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-manifests'),pin('extforge-bundles'),pin('extforge-reviews')],systemDependencies:['extensionTrialRuntime'],services:['extforgeCatalogs'],contributes:{http:extforgeHttp('catalogs'),routes:extforgeRoutes('catalogs')}});
