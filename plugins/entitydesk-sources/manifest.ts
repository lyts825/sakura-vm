/** 原始台账的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-sources',name:"原始台账",description:"原文件、字段档案、记录定位及许可",category:'development',experimental:true,requires:[pin('entitydesk-spaces')],systemDependencies:['entityMatchingCompute'],services:['entitydeskSources'],contributes:{http:entitydeskHttp('sources'),routes:entitydeskRoutes('sources')}});
