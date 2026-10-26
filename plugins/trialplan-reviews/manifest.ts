/** 设计与结果复核的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-reviews',name:"设计与结果复核",description:"计划时序、偏离、解释及限制决定",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-questions'),pin('trialplan-powerplans'),pin('trialplan-assignments'),pin('trialplan-observations'),pin('trialplan-analyses'),pin('trialplan-sensitivity')],systemDependencies:['controlledExperimentCompute'],services:['trialplanReviews'],contributes:{http:trialplanHttp('reviews'),routes:trialplanRoutes('reviews')}});
