/** 评估分区的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-partitions',name:"评估分区",description:"训练、验证、测试、实体组和交叉验证成员",category:'development',experimental:true,requires:[pin('ctrain-spaces'),pin('ctrain-datasets'),pin('ctrain-targets')],systemDependencies:['classicalTrainingSessions'],services:['ctrainPartitions'],contributes:{http:ctrainHttp('partitions'),routes:ctrainRoutes('partitions')}});
