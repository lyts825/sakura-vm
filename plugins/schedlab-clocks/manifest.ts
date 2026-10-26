/** 时钟档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {schedlabRoutes,schedlabHttp} from '../../shared/contracts/schedlab-routes.generated.ts';
export const manifest=definePlugin({id:'schedlab-clocks',name:"时钟档案",description:"时区数据库版本、墙上时间与单调时间映射",category:'development',experimental:true,requires:[pin('schedlab-spaces')],systemDependencies:['scheduleModelCompute'],services:['schedlabClocks'],contributes:{http:schedlabHttp('clocks'),routes:schedlabRoutes('clocks')}});
