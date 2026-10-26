/** 表单接口的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-interfaces',name:"表单接口",description:"路由、面板、字段及输入约束",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-manifests')],systemDependencies:['extensionTrialRuntime'],services:['extforgeInterfaces'],contributes:{http:extforgeHttp('interfaces'),routes:extforgeRoutes('interfaces')}});
