/** 取值域的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-domains',name:"取值域",description:"布尔/整数边界、候选集合及界限来源",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-variables')],systemDependencies:['constraintSolveSessions'],services:['csolveDomains'],contributes:{http:csolveHttp('domains'),routes:csolveRoutes('domains')}});
