/** 训练报告的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-reports',name:"训练报告",description:"数据/工具/候选摘要、限制与人工接受",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-datasets'),pin('ctrain-targets'),pin('ctrain-partitions'),pin('ctrain-estimators'),pin('ctrain-searches'),pin('ctrain-runs'),pin('ctrain-predictions'),pin('ctrain-metrics'),pin('ctrain-comparisons'),pin('ctrain-explanations'),pin('ctrain-registry')],systemDependencies:['classicalTrainingSessions'],services:['ctrainReports'],contributes:{http:ctrainHttp('reports'),routes:ctrainRoutes('reports')}});
