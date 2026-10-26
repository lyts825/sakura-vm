/** 同步交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {replabRoutes,replabHttp} from '../../shared/contracts/replab-routes.generated.ts';
export const manifest=definePlugin({id:'replab-exchange',name:"同步交接",description:"模型、历史和报告的隔离交换",category:'development',experimental:true,requires:[pin('replab-spaces'),pin('replab-schemas'),pin('replab-replicas'),pin('replab-operations'),pin('replab-clocks'),pin('replab-channels'),pin('replab-policies'),pin('replab-scenarios'),pin('replab-runs'),pin('replab-conflicts'),pin('replab-judgments'),pin('replab-reports')],services:['replabExchange'],contributes:{http:replabHttp('exchange'),routes:replabRoutes('exchange')}});
