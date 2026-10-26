/** 数据约定的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-schemas',name:"数据约定",description:"类型、枚举、默认值、必填和规范化规则",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-fields')],systemDependencies:['formDefinitionEvaluate'],services:['fformSchemas'],contributes:{http:fformHttp('schemas'),routes:fformRoutes('schemas')}});
