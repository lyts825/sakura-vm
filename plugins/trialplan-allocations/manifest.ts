/** 分组设计的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-allocations',name:"分组设计",description:"分配比例、分层、区组及固定种子策略",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-populations')],systemDependencies:['controlledExperimentCompute'],services:['trialplanAllocations'],contributes:{http:trialplanHttp('allocations'),routes:trialplanRoutes('allocations')}});
