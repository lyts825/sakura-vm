/** 调度交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-exchange',name:"调度交接",description:"规则、场景与报告的隔离交换",category:'development',experimental:true,requires:[pin('schedlab-spaces'),pin('schedlab-calendars'),pin('schedlab-clocks'),pin('schedlab-rules'),pin('schedlab-policies'),pin('schedlab-workloads'),pin('schedlab-scenarios'),pin('schedlab-simulations'),pin('schedlab-harness'),pin('schedlab-observations'),pin('schedlab-checks'),pin('schedlab-reports')],services:['schedlabExchange'],contributes:{http:schedlabHttp('exchange'),routes:schedlabRoutes('exchange')}});
