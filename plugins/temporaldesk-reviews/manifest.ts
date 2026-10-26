/** 语义复核的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {temporaldeskRoutes,temporaldeskHttp} from '../../shared/contracts/temporaldesk-routes.generated.ts';
export const manifest=definePlugin({id:'temporaldesk-reviews',name:"语义复核",description:"歧义时刻、估计偏移和适用范围决定",category:'development',experimental:true,requires:[pin('temporaldesk-spaces'),pin('temporaldesk-semantics'),pin('temporaldesk-alignment'),pin('temporaldesk-runs'),pin('temporaldesk-comparisons')],systemDependencies:['temporalSeriesCompute'],services:['temporaldeskReviews'],contributes:{http:temporaldeskHttp('reviews'),routes:temporaldeskRoutes('reviews')}});
