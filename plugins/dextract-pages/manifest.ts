/** 页面拆解的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-pages',name:"页面拆解",description:"页索引、尺寸、旋转、文本层与页图字节",category:'development',experimental:true,requires:[pin('dextract-spaces'),pin('dextract-sources')],systemDependencies:['documentExtractionSessions'],services:['dextractPages'],contributes:{http:dextractHttp('pages'),routes:dextractRoutes('pages')}});
