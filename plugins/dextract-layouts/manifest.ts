/** 版面区域的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-layouts',name:"版面区域",description:"段落、标题、表格候选与阅读顺序",category:'development',experimental:true,requires:[pin('dextract-spaces'),pin('dextract-pages')],systemDependencies:['documentExtractionSessions'],services:['dextractLayouts'],contributes:{http:dextractHttp('layouts'),routes:dextractRoutes('layouts')}});
