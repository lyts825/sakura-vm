/** 指标定义的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-outcomes',name:"指标定义",description:"主要指标、分母、窗口和缺失策略",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-questions'),pin('trialplan-populations')],systemDependencies:['controlledExperimentCompute'],services:['trialplanOutcomes'],contributes:{http:trialplanHttp('outcomes'),routes:trialplanRoutes('outcomes')}});
