/** 工具档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-toolchains',name:"工具档案",description:"固定离线编译器、SDK、参数与支持范围",category:'development',experimental:true,requires:[pin('extforge-spaces')],systemDependencies:['extensionTrialRuntime'],services:['extforgeToolchains'],contributes:{http:extforgeHttp('toolchains'),routes:extforgeRoutes('toolchains')}});
