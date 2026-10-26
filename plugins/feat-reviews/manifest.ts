/** 使用复核的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-reviews',name:"使用复核",description:"数据适用域、人工例外及接受记录",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-artifacts'),pin('feat-checks')],systemDependencies:['featureTransformCompute'],services:['featReviews'],contributes:{http:featHttp('reviews'),routes:featRoutes('reviews')}});
