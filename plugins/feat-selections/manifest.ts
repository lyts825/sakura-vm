/** 特征选择的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-selections',name:"特征选择",description:"固定列集合、筛选标准及训练域分数",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-partitions'),pin('feat-fits')],systemDependencies:['featureTransformCompute'],services:['featSelections'],contributes:{http:featHttp('selections'),routes:featRoutes('selections')}});
