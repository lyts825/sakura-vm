/** 字段目录的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-fields',name:"字段目录",description:"稳定字段 ID、输入类型、标签与帮助文本",category:'development',experimental:true,requires:[pin('fform-spaces')],systemDependencies:['formDefinitionEvaluate'],services:['fformFields'],contributes:{http:fformHttp('fields'),routes:fformRoutes('fields')}});
