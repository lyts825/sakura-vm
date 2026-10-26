/** 表单空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-spaces',name:"表单空间",description:"空间、模板、额度与访问修订",category:'development',experimental:true,requires:[],systemDependencies:['formDefinitionEvaluate'],services:['fformSpaces'],contributes:{http:fformHttp('spaces'),routes:fformRoutes('spaces')}});
