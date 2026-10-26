/** 时间材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-sources',name:"时间材料",description:"原记录、解析档案和来源许可",category:'development',experimental:true,requires:[pin('temporaldesk-spaces')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskSources'],contributes:{http:temporaldeskHttp('sources'),routes:temporaldeskRoutes('sources')}});
