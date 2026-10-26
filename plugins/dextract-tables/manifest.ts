/** 表格重建的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-tables',name:"表格重建",description:"行列、合并单元格、跨页候选与来源框",category:'development',experimental:true,requires:[pin('dextract-spaces'),pin('dextract-pages'),pin('dextract-layouts'),pin('dextract-ocr')],systemDependencies:['documentExtractionSessions'],services:['dextractTables'],contributes:{http:dextractHttp('tables'),routes:dextractRoutes('tables')}});
