/** 求解空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-spaces',name:"求解空间",description:"空间、模板、额度及访问修订",category:'development',experimental:true,requires:[],systemDependencies:['constraintSolveSessions'],services:['csolveSpaces'],contributes:{http:csolveHttp('spaces'),routes:csolveRoutes('spaces')}});
