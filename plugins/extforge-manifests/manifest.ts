/** 扩展声明的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-manifests',name:"扩展声明",description:"插件标识、版本、描述和发布者公钥引用",category:'development',experimental:true,requires:[pin('extforge-spaces')],systemDependencies:['extensionTrialRuntime'],services:['extforgeManifests'],contributes:{http:extforgeHttp('manifests'),routes:extforgeRoutes('manifests')}});
