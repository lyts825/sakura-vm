/** 求解任务的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {csolveRoutes,csolveHttp} from '../../shared/contracts/csolve-routes.generated.ts';
export const manifest=definePlugin({id:'csolve-runs',name:"求解任务",description:"完整模型计划、求解器票据、日志与状态",category:'development',experimental:true,requires:[pin('csolve-spaces'),pin('csolve-variables'),pin('csolve-domains'),pin('csolve-constraints'),pin('csolve-objectives'),pin('csolve-scenarios')],systemDependencies:['constraintSolveSessions'],services:['csolveRuns'],contributes:{http:csolveHttp('runs'),routes:csolveRoutes('runs')}});
