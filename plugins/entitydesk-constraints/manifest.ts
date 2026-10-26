/** 合并约束的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-constraints',name:"合并约束",description:"必须同组、禁止同组和互斥来源条件",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-sources'),pin('entitydesk-candidates')],systemDependencies:['entityMatchingCompute'],services:['entitydeskConstraints'],contributes:{http:entitydeskHttp('constraints'),routes:entitydeskRoutes('constraints')}});
