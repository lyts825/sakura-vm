/** 关联配方的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-joins',name:"关联配方",description:"关联键、基数、重复处理与来源时点",category:'development',experimental:true,requires:[pin('feat-spaces'),pin('feat-sources'),pin('feat-schemas'),pin('feat-partitions')],systemDependencies:['featureTransformCompute'],services:['featJoins'],contributes:{http:featHttp('joins'),routes:featRoutes('joins')}});
