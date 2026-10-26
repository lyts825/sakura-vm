/** 学习目标的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-targets',name:"学习目标",description:"任务类型、标签、类别及度量方向",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-datasets')],systemDependencies:['classicalTrainingSessions'],services:['ctrainTargets'],contributes:{http:ctrainHttp('targets'),routes:ctrainRoutes('targets')}});
