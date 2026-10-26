/** 字符识别的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-ocr',name:"字符识别",description:"固定语言模型、区域识别任务和字符位置",category:'development',experimental:true,requires:[pin('dextract-spaces'),pin('dextract-pages'),pin('dextract-layouts')],systemDependencies:['documentExtractionSessions'],services:['dextractOcr'],contributes:{http:dextractHttp('ocr'),routes:dextractRoutes('ocr')}});
