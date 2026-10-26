/** 评估指标的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-metrics',name:"评估指标",description:"逐分区指标、混淆表、残差和样本缺项",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-datasets'),pin('ctrain-targets'),pin('ctrain-partitions'),pin('ctrain-predictions')],systemDependencies:['classicalTrainingSessions'],services:['ctrainMetrics'],contributes:{http:ctrainHttp('metrics'),routes:ctrainRoutes('metrics')}});
