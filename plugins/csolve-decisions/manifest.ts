/** 方案接受的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-decisions',name:"方案接受",description:"人工选择、未满足前提、例外和封存引用",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-scenarios'),pin('csolve-solutions'),pin('csolve-validation'),pin('csolve-conflicts'),pin('csolve-sensitivity')],systemDependencies:['constraintSolveSessions'],services:['csolveDecisions'],contributes:{http:csolveHttp('decisions'),routes:csolveRoutes('decisions')}});
