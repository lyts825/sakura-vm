/** 表格来源的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {featRoutes,featHttp} from '../../shared/contracts/feat-routes.generated.ts';
export const manifest=definePlugin({id:'feat-sources',name:"表格来源",description:"原始 CSV/JSONL 字节、固定修订与列摘要",category:'development',experimental:true,requires:[pin('feat-spaces')],systemDependencies:['featureTransformCompute'],services:['featSources'],contributes:{http:featHttp('sources'),routes:featRoutes('sources')}});
