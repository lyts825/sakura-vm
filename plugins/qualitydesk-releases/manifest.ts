/** 批次放行的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-releases',name:"批次放行",description:"固定检查、对账、未决项和人工放行决定",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-partitions'),pin('qualitydesk-runs'),pin('qualitydesk-findings'),pin('qualitydesk-reconciliation'),pin('qualitydesk-exceptions')],systemDependencies:['batchQualityCompute'],services:['qualitydeskReleases'],contributes:{http:qualitydeskHttp('releases'),routes:qualitydeskRoutes('releases')}});
