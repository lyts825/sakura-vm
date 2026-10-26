/** 研究问题的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-questions',name:"研究问题",description:"方案对照、目标差异、假设和适用范围",category:'development',experimental:true,requires:[pin('trialplan-spaces')],systemDependencies:['controlledExperimentCompute'],services:['trialplanQuestions'],contributes:{http:trialplanHttp('questions'),routes:trialplanRoutes('questions')}});
