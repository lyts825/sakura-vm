/** 规范实体版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-versions',name:"规范实体版本",description:"规范记录、原记录映射和拆分历史",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-sources'),pin('entitydesk-decisions'),pin('entitydesk-survivors')],systemDependencies:['entityMatchingCompute'],services:['entitydeskVersions'],contributes:{http:entitydeskHttp('versions'),routes:entitydeskRoutes('versions')}});
