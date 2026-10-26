/** 泄漏与结果检查的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-checks',name:"泄漏与结果检查",description:"分区交叉、未来信息、未知类别及输出统计",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-schemas'),pin('feat-partitions'),pin('feat-joins'),pin('feat-windows'),pin('feat-fits'),pin('feat-runs')],systemDependencies:['featureTransformCompute'],services:['featChecks'],contributes:{http:featHttp('checks'),routes:featRoutes('checks')}});
