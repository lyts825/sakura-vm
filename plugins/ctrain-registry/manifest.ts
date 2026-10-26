/** 模型登记的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-registry',name:"模型登记",description:"模型引用、输入约定、预处理及适用域",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-datasets'),pin('ctrain-targets'),pin('ctrain-partitions'),pin('ctrain-estimators'),pin('ctrain-runs'),pin('ctrain-comparisons')],systemDependencies:['classicalTrainingSessions'],services:['ctrainRegistry'],contributes:{http:ctrainHttp('registry'),routes:ctrainRoutes('registry')}});
