/** 归并档案的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-reports',name:"归并档案",description:"阈值、覆盖、复核、未决项和版本差异",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-candidates'),pin('entitydesk-clusters'),pin('entitydesk-decisions'),pin('entitydesk-evaluations'),pin('entitydesk-versions')],systemDependencies:['entityMatchingCompute'],services:['entitydeskReports'],contributes:{http:entitydeskHttp('reports'),routes:entitydeskRoutes('reports')}});
