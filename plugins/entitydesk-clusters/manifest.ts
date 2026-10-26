/** 候选簇的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-clusters',name:"候选簇",description:"簇提议、冲突边和连通性解释",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-candidates'),pin('entitydesk-constraints')],systemDependencies:['entityMatchingCompute'],services:['entitydeskClusters'],contributes:{http:entitydeskHttp('clusters'),routes:entitydeskRoutes('clusters')}});
