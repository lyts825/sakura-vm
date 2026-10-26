/** 特征工作台的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-workbench',name:"特征工作台",description:"配方画布、列来源、运行与版本导航",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-sources'),pin('feat-schemas'),pin('feat-partitions'),pin('feat-transforms'),pin('feat-joins'),pin('feat-windows'),pin('feat-fits'),pin('feat-selections'),pin('feat-runs'),pin('feat-checks'),pin('feat-artifacts'),pin('feat-reviews'),pin('feat-exchange')],systemDependencies:['featureTransformCompute'],services:['featWorkbench'],contributes:{pages:['feature-engineering-studio'],http:featHttp('workbench'),routes:featRoutes('workbench')}});
