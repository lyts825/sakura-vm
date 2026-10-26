/** 固定预测的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-predictions',name:"固定预测",description:"模型版本对应的逐行预测、概率及推理票据",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-datasets'),pin('ctrain-partitions'),pin('ctrain-runs')],systemDependencies:['classicalTrainingSessions'],services:['ctrainPredictions'],contributes:{http:ctrainHttp('predictions'),routes:ctrainRoutes('predictions')}});
