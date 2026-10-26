/** 周期规则的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-rules',name:"周期规则",description:"固定间隔和受限五字段周期表达式",category:'development',experimental:true,requires:[pin('schedlab-spaces'),pin('schedlab-calendars'),pin('schedlab-clocks')],systemDependencies:['scheduleModelCompute'],services:['schedlabRules'],contributes:{http:schedlabHttp('rules'),routes:schedlabRoutes('rules')}});
