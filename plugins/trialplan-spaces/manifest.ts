/** 规划空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-spaces',name:"规划空间",description:"空间、授权和额度",category:'development',experimental:true,requires:[],systemDependencies:['controlledExperimentCompute'],services:['trialplanSpaces'],contributes:{http:trialplanHttp('spaces'),routes:trialplanRoutes('spaces')}});
