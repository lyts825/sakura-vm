/** 条件逻辑的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-logic',name:"条件逻辑",description:"显隐、计算与跳转的有限表达式图",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-fields'),pin('fform-schemas')],systemDependencies:['formDefinitionEvaluate'],services:['fformLogic'],contributes:{http:fformHttp('logic'),routes:fformRoutes('logic')}});
