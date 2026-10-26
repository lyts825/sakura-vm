/** 模型交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-exchange',name:"模型交接",description:"白名单模型格式、报告封套及隔离映射",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-datasets'),pin('ctrain-targets'),pin('ctrain-partitions'),pin('ctrain-estimators'),pin('ctrain-searches'),pin('ctrain-runs'),pin('ctrain-predictions'),pin('ctrain-metrics'),pin('ctrain-comparisons'),pin('ctrain-explanations'),pin('ctrain-registry'),pin('ctrain-reports')],services:['ctrainExchange'],contributes:{http:ctrainHttp('exchange'),routes:ctrainRoutes('exchange')}});
