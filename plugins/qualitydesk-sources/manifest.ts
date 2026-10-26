/** 批次材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-sources',name:"批次材料",description:"原始文件、解析档案和许可",category:'development',experimental:true,requires:[pin('qualitydesk-spaces')],systemDependencies:['batchQualityCompute'],services:['qualitydeskSources'],contributes:{http:qualitydeskHttp('sources'),routes:qualitydeskRoutes('sources')}});
