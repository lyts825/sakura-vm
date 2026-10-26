/** 发布审阅的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {extforgeRoutes,extforgeHttp} from '../../shared/contracts/extforge-routes.generated.ts';
export const manifest=definePlugin({id:'extforge-reviews',name:"发布审阅",description:"用例结论、描述适用性、未覆盖项和人工决定",category:'development',experimental:true,requires:[pin('extforge-spaces'),pin('extforge-inspections'),pin('extforge-trials'),pin('extforge-bundles')],systemDependencies:['extensionTrialRuntime'],services:['extforgeReviews'],contributes:{http:extforgeHttp('reviews'),routes:extforgeRoutes('reviews')}});
