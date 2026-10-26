/** 字段取值的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-survivors',name:"字段取值",description:"来源优先级、逐字段冲突和取值证据",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-sources'),pin('entitydesk-normalization'),pin('entitydesk-decisions')],systemDependencies:['entityMatchingCompute'],services:['entitydeskSurvivors'],contributes:{http:entitydeskHttp('survivors'),routes:entitydeskRoutes('survivors')}});
