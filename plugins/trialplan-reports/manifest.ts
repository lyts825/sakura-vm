/** 实验规划档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-reports',name:"实验规划档案",description:"设计、模拟、观测、结果和限制的固定索引",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-questions'),pin('trialplan-powerplans'),pin('trialplan-assignments'),pin('trialplan-observations'),pin('trialplan-analyses'),pin('trialplan-sensitivity'),pin('trialplan-reviews')],systemDependencies:['controlledExperimentCompute'],services:['trialplanReports'],contributes:{http:trialplanHttp('reports'),routes:trialplanRoutes('reports')}});
