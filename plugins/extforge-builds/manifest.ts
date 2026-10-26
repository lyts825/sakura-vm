/** 受控编译的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-builds',name:"受控编译",description:"专属客户机、构建意图、WASM 与诊断字节",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-sources'),pin('extforge-toolchains'),pin('projects')],systemDependencies:['extensionTrialRuntime','extensionBuildSessions','imageAssets'],services:['extforgeBuilds'],contributes:{http:extforgeHttp('builds'),routes:extforgeRoutes('builds')}});
