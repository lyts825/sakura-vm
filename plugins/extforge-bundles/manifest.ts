/** 发行候选的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-bundles',name:"发行候选",description:"WASM、目录条目、相对 URL 与不可变版本集合",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-manifests'),pin('extforge-interfaces'),pin('extforge-builds'),pin('extforge-inspections'),pin('extforge-signatures')],systemDependencies:['extensionTrialRuntime'],services:['extforgeBundles'],contributes:{http:extforgeHttp('bundles'),routes:extforgeRoutes('bundles')}});
