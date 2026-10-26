/** 试填记录的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-submissions',name:"试填记录",description:"明示为本地样例的提交、错误和字段来源",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-schemas'),pin('fform-previews')],systemDependencies:['formDefinitionEvaluate'],services:['fformSubmissions'],contributes:{http:fformHttp('submissions'),routes:fformRoutes('submissions')}});
