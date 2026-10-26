/** 敏感性分析的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-sensitivity',name:"敏感性分析",description:"缺失、异常值和偏离的预设替代场景",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-outcomes'),pin('trialplan-observations'),pin('trialplan-analyses')],systemDependencies:['controlledExperimentCompute'],services:['trialplanSensitivity'],contributes:{http:trialplanHttp('sensitivity'),routes:trialplanRoutes('sensitivity')}});
