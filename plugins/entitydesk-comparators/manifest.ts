/** 比较器版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-comparators',name:"比较器版本",description:"精确匹配、编辑距离及数值容差",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-normalization')],systemDependencies:['entityMatchingCompute'],services:['entitydeskComparators'],contributes:{http:entitydeskHttp('comparators'),routes:entitydeskRoutes('comparators')}});
