/** 候选分组的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-blocks',name:"候选分组",description:"阻塞键、邻域范围和候选覆盖声明",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-sources'),pin('entitydesk-normalization')],systemDependencies:['entityMatchingCompute'],services:['entitydeskBlocks'],contributes:{http:entitydeskHttp('blocks'),routes:entitydeskRoutes('blocks')}});
