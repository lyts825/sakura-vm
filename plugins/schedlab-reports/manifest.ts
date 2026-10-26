/** 调度报告的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-reports',name:"调度报告",description:"规则版本、覆盖范围、人工说明和核销索引",category:'development',experimental:true,requires:[pin('schedlab-spaces'),pin('schedlab-scenarios'),pin('schedlab-simulations'),pin('schedlab-harness'),pin('schedlab-observations'),pin('schedlab-checks')],systemDependencies:['scheduleModelCompute'],services:['schedlabReports'],contributes:{http:schedlabHttp('reports'),routes:schedlabRoutes('reports')}});
