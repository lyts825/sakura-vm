/** 单位与总体的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-populations',name:"单位与总体",description:"单位清单、纳入规则、分层和簇关系",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-questions')],systemDependencies:['controlledExperimentCompute'],services:['trialplanPopulations'],contributes:{http:trialplanHttp('populations'),routes:trialplanRoutes('populations')}});
