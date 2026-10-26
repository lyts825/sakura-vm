/** 表单版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-versions',name:"表单版本",description:"定义、提示、样例及覆盖结果的固定引用图",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-fields'),pin('fform-schemas'),pin('fform-logic'),pin('fform-pages'),pin('fform-fixtures'),pin('fform-validations'),pin('fform-submissions')],systemDependencies:['formDefinitionEvaluate'],services:['fformVersions'],contributes:{http:fformHttp('versions'),routes:fformRoutes('versions')}});
