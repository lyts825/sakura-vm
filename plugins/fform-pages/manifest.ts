/** 步骤编排的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-pages',name:"步骤编排",description:"页面、字段顺序、导航和可达性",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-fields'),pin('fform-logic')],systemDependencies:['formDefinitionEvaluate'],services:['fformPages'],contributes:{http:fformHttp('pages'),routes:fformRoutes('pages')}});
