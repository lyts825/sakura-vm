/** 交互预览的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-previews',name:"交互预览",description:"固定定义预览会话、草稿及导航轨迹",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-fields'),pin('fform-schemas'),pin('fform-logic'),pin('fform-pages'),pin('fform-validations')],systemDependencies:['formDefinitionEvaluate'],services:['fformPreviews'],contributes:{http:fformHttp('previews'),routes:fformRoutes('previews')}});
