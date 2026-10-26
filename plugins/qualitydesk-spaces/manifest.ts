/** 质量空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {qualitydeskRoutes,qualitydeskHttp} from '../../shared/contracts/qualitydesk-routes.generated.ts';
export const manifest=definePlugin({id:'qualitydesk-spaces',name:"质量空间",description:"空间、授权修订和额度",category:'development',experimental:true,requires:[],systemDependencies:['batchQualityCompute'],services:['qualitydeskSpaces'],contributes:{http:qualitydeskHttp('spaces'),routes:qualitydeskRoutes('spaces')}});
