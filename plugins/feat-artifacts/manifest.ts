/** 特征版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-artifacts',name:"特征版本",description:"配方、拟合参数及矩阵的固定引用图",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-sources'),pin('feat-schemas'),pin('feat-partitions'),pin('feat-transforms'),pin('feat-joins'),pin('feat-windows'),pin('feat-fits'),pin('feat-selections'),pin('feat-runs'),pin('feat-checks')],systemDependencies:['featureTransformCompute'],services:['featArtifacts'],contributes:{http:featHttp('artifacts'),routes:featRoutes('artifacts')}});
