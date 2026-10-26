/** 观测材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-observations',name:"观测材料",description:"原资料、实际接触、偏离及数据截止",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-populations'),pin('trialplan-outcomes'),pin('trialplan-assignments')],systemDependencies:['controlledExperimentCompute'],services:['trialplanObservations'],contributes:{http:trialplanHttp('observations'),routes:trialplanRoutes('observations')}});
