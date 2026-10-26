/** 人工裁决的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-decisions',name:"人工裁决",description:"成对及簇级接受、拒绝、暂缓和理由",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-sources'),pin('entitydesk-candidates'),pin('entitydesk-constraints'),pin('entitydesk-clusters')],systemDependencies:['entityMatchingCompute'],services:['entitydeskDecisions'],contributes:{http:entitydeskHttp('decisions'),routes:entitydeskRoutes('decisions')}});
