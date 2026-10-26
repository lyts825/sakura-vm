/** 分析计划与结果的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-analyses',name:"分析计划与结果",description:"预设方法、固定观测、估计和覆盖",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-questions'),pin('trialplan-populations'),pin('trialplan-outcomes'),pin('trialplan-allocations'),pin('trialplan-assignments'),pin('trialplan-observations')],systemDependencies:['controlledExperimentCompute'],services:['trialplanAnalyses'],contributes:{http:trialplanHttp('analyses'),routes:trialplanRoutes('analyses')}});
