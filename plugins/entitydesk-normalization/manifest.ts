/** 标准化规则的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {entitydeskRoutes,entitydeskHttp} from '../../shared/contracts/entitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'entitydesk-normalization',name:"标准化规则",description:"大小写、空白、单位和有限词典映射",category:'development',experimental:true,requires:[pin('entitydesk-spaces'),pin('entitydesk-sources')],systemDependencies:['entityMatchingCompute'],services:['entitydeskNormalization'],contributes:{http:entitydeskHttp('normalization'),routes:entitydeskRoutes('normalization')}});
