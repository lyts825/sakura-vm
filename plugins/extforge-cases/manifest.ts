/** 用例材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-cases',name:"用例材料",description:"JSON 输入、结果断言、边界与错误期望",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-interfaces')],systemDependencies:['extensionTrialRuntime'],services:['extforgeCases'],contributes:{http:extforgeHttp('cases'),routes:extforgeRoutes('cases')}});
