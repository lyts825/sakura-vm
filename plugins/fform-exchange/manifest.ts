/** 表单交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-exchange',name:"表单交接",description:"定义与样例封套、模式检查及本地映射",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-fields'),pin('fform-schemas'),pin('fform-logic'),pin('fform-pages'),pin('fform-fixtures'),pin('fform-validations'),pin('fform-previews'),pin('fform-submissions'),pin('fform-versions'),pin('fform-reviews')],services:['fformExchange'],contributes:{http:fformHttp('exchange'),routes:fformRoutes('exchange')}});
