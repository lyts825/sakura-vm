/** 批次画像的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-profiles',name:"批次画像",description:"行数、缺失率、有限分布和计算证据",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-sources'),pin('qualitydesk-partitions')],systemDependencies:['batchQualityCompute'],services:['qualitydeskProfiles'],contributes:{http:qualitydeskHttp('profiles'),routes:qualitydeskRoutes('profiles')}});
