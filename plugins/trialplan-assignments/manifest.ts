/** 分配版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-assignments',name:"分配版本",description:"固定单位分配表及算法回执",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-populations'),pin('trialplan-allocations'),pin('trialplan-powerplans')],systemDependencies:['controlledExperimentCompute'],services:['trialplanAssignments'],contributes:{http:trialplanHttp('assignments'),routes:trialplanRoutes('assignments')}});
