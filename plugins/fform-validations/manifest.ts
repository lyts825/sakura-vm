/** 校验执行的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-validations',name:"校验执行",description:"字段/跨字段规则结果、路径覆盖和错误顺序",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-fields'),pin('fform-schemas'),pin('fform-logic'),pin('fform-pages'),pin('fform-fixtures')],systemDependencies:['formDefinitionEvaluate'],services:['fformValidations'],contributes:{http:fformHttp('validations'),routes:fformRoutes('validations')}});
