/** 开发空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-spaces',name:"开发空间",description:"空间授权、模板修订和额度根账本",category:'development',experimental:true,requires:[],systemDependencies:['extensionTrialRuntime'],services:['extforgeSpaces'],contributes:{http:extforgeHttp('spaces'),routes:extforgeRoutes('spaces')}});
