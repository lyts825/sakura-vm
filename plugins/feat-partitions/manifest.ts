/** 样本分区的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-partitions',name:"样本分区",description:"训练/验证/测试成员、实体组与时间界限",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-sources'),pin('feat-schemas')],systemDependencies:['featureTransformCompute'],services:['featPartitions'],contributes:{http:featHttp('partitions'),routes:featRoutes('partitions')}});
