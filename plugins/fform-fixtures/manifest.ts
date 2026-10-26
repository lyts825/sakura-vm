/** 样例材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-fixtures',name:"样例材料",description:"合成试填值、路径期望和边界案例",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-fields'),pin('fform-schemas'),pin('fform-pages')],systemDependencies:['formDefinitionEvaluate'],services:['fformFixtures'],contributes:{http:fformHttp('fixtures'),routes:fformRoutes('fixtures')}});
