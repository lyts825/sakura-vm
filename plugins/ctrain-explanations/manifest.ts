/** 模型解释的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-explanations',name:"模型解释",description:"系数、树结构或有限扰动观察",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-datasets'),pin('ctrain-runs'),pin('ctrain-predictions'),pin('ctrain-metrics')],systemDependencies:['classicalTrainingSessions'],services:['ctrainExplanations'],contributes:{http:ctrainHttp('explanations'),routes:ctrainRoutes('explanations')}});
