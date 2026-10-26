/** 冲突解释的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-conflicts',name:"冲突解释",description:"不可满足候选子集、最小性范围与核验轨迹",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-constraints'),pin('csolve-scenarios'),pin('csolve-runs')],systemDependencies:['constraintSolveSessions'],services:['csolveConflicts'],contributes:{http:csolveHttp('conflicts'),routes:csolveRoutes('conflicts')}});
