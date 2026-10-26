/** 规模模拟的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-powerplans',name:"规模模拟",description:"基线假设、效应场景、模拟和不确定性",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-questions'),pin('trialplan-populations'),pin('trialplan-outcomes'),pin('trialplan-allocations')],systemDependencies:['controlledExperimentCompute'],services:['trialplanPowerplans'],contributes:{http:trialplanHttp('powerplans'),routes:trialplanRoutes('powerplans')}});
