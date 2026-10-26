/** 实验资料交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {trialplanRoutes,trialplanHttp} from '../../shared/contracts/trialplan-routes.generated.ts';
export const manifest=definePlugin({id:'trialplan-exchange',name:"实验资料交接",description:"计划、分配和允许披露的资料交换",category:'development',experimental:true,requires:[pin('trialplan-spaces'),pin('trialplan-questions'),pin('trialplan-populations'),pin('trialplan-outcomes'),pin('trialplan-allocations'),pin('trialplan-powerplans'),pin('trialplan-assignments'),pin('trialplan-observations'),pin('trialplan-analyses'),pin('trialplan-sensitivity'),pin('trialplan-reviews'),pin('trialplan-reports')],services:['trialplanExchange'],contributes:{http:trialplanHttp('exchange'),routes:trialplanRoutes('exchange')}});
