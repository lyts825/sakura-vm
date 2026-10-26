/** 提取复核的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-reviews',name:"提取复核",description:"页覆盖、抽检范围、人工决定与未决项",category:'development',experimental:true,requires:[pin('dextract-spaces'),pin('dextract-datasets'),pin('dextract-checks'),pin('dextract-corrections')],systemDependencies:['documentExtractionSessions'],services:['dextractReviews'],contributes:{http:dextractHttp('reviews'),routes:dextractRoutes('reviews')}});
