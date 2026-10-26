/** 接收核对单的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-checklists',name:"接收核对单",description:"已封存档案的接收清单和核对意见",category:'development',experimental:true,requires:[pin('qualitydesk-spaces'),pin('qualitydesk-reports'),pin('qualitydesk-exchange')],systemDependencies:['batchQualityCompute'],services:['qualitydeskChecklists'],contributes:{http:qualitydeskHttp('checklists'),routes:qualitydeskRoutes('checklists')}});
