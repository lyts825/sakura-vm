/** 历史窗口的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-windows',name:"历史窗口",description:"观察时点、回看区间与边界约定",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-schemas'),pin('feat-partitions')],systemDependencies:['featureTransformCompute'],services:['featWindows'],contributes:{http:featHttp('windows'),routes:featRoutes('windows')}});
