/** 原文材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-sources',name:"原文材料",description:"PDF/PNG/JPEG 原字节、许可和摘要",category:'development',experimental:true,requires:[pin('dextract-spaces')],systemDependencies:['documentExtractionSessions'],services:['dextractSources'],contributes:{http:dextractHttp('sources'),routes:dextractRoutes('sources')}});
