/** 源码材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-sources',name:"源码材料",description:"固定源码树、文件修订和源摘要",category:'development',experimental:true,requires:[pin('extforge-spaces')],systemDependencies:['extensionTrialRuntime'],services:['extforgeSources'],contributes:{http:extforgeHttp('sources'),routes:extforgeRoutes('sources')}});
