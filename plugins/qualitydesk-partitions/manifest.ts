/** 分区与批次的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-partitions',name:"分区与批次",description:"业务日期、分区键、批次范围和完整性声明",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-sources')],systemDependencies:['batchQualityCompute'],services:['qualitydeskPartitions'],contributes:{http:qualitydeskHttp('partitions'),routes:qualitydeskRoutes('partitions')}});
