/** 情景比较的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-sensitivity',name:"情景比较",description:"有界参数扰动、重新求解意图及结果差异",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-scenarios'),pin('csolve-runs'),pin('csolve-solutions'),pin('csolve-validation')],systemDependencies:['constraintSolveSessions'],services:['csolveSensitivity'],contributes:{http:csolveHttp('sensitivity'),routes:csolveRoutes('sensitivity')}});
