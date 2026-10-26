/** 算法配方的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-estimators',name:"算法配方",description:"固定算法、参数类型、预处理和工具摘要",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-targets'),pin('ctrain-partitions')],systemDependencies:['classicalTrainingSessions'],services:['ctrainEstimators'],contributes:{http:ctrainHttp('estimators'),routes:ctrainRoutes('estimators')}});
