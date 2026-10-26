/** 特征生成的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-runs',name:"特征生成",description:"固定计划、工具任务与输出矩阵字节",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-sources'),pin('feat-schemas'),pin('feat-partitions'),pin('feat-transforms'),pin('feat-joins'),pin('feat-windows'),pin('feat-fits'),pin('feat-selections')],systemDependencies:['featureTransformCompute'],services:['featRuns'],contributes:{http:featHttp('runs'),routes:featRoutes('runs')}});
