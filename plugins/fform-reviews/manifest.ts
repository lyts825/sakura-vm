/** 表单复核的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {fformRoutes,fformHttp} from '../../shared/contracts/fform-routes.generated.ts';
export const manifest=definePlugin({id:'fform-reviews',name:"表单复核",description:"业务要求、人工体验意见及发布接受",category:'development',experimental:true,requires:[pin('fform-spaces'),pin('fform-versions'),pin('fform-validations')],systemDependencies:['formDefinitionEvaluate'],services:['fformReviews'],contributes:{http:fformHttp('reviews'),routes:fformRoutes('reviews')}});
