/** 拟合参数的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-fits',name:"拟合参数",description:"仅由训练成员计算的统计量、词表和参数摘要",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-sources'),pin('feat-schemas'),pin('feat-partitions'),pin('feat-transforms'),pin('feat-joins'),pin('feat-windows')],systemDependencies:['featureTransformCompute'],services:['featFits'],contributes:{http:featHttp('fits'),routes:featRoutes('fits')}});
