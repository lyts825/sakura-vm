/** 情景版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-scenarios',name:"情景版本",description:"固定参数替换、启用约束与比较基线",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-variables'),pin('csolve-domains'),pin('csolve-constraints'),pin('csolve-objectives')],systemDependencies:['constraintSolveSessions'],services:['csolveScenarios'],contributes:{http:csolveHttp('scenarios'),routes:csolveRoutes('scenarios')}});
