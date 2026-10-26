/** 训练任务的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-runs',name:"训练任务",description:"训练意图、原工具票据、模型字节与日志",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-datasets'),pin('ctrain-targets'),pin('ctrain-partitions'),pin('ctrain-estimators'),pin('ctrain-searches')],systemDependencies:['classicalTrainingSessions'],services:['ctrainRuns'],contributes:{http:ctrainHttp('runs'),routes:ctrainRoutes('runs')}});
