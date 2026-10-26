/** 表单工作台的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-workbench',name:"表单工作台",description:"字段/步骤编辑、路径图、预览与版本导航",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-fields'),pin('fform-schemas'),pin('fform-logic'),pin('fform-pages'),pin('fform-fixtures'),pin('fform-validations'),pin('fform-previews'),pin('fform-submissions'),pin('fform-versions'),pin('fform-reviews'),pin('fform-exchange')],systemDependencies:['formDefinitionEvaluate'],services:['fformWorkbench'],contributes:{pages:['form-flow-studio'],http:fformHttp('workbench'),routes:fformRoutes('workbench')}});
