/** 候选方案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-solutions',name:"候选方案",description:"变量赋值、目标值、界限及求解来源",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-variables'),pin('csolve-objectives'),pin('csolve-runs')],systemDependencies:['constraintSolveSessions'],services:['csolveSolutions'],contributes:{http:csolveHttp('solutions'),routes:csolveRoutes('solutions')}});
