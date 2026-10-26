/** 数据版本的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-datasets',name:"数据版本",description:"按固定纠错修订组装的文本、表格及字段结果",category:'development',experimental:true,requires:[pin('dextract-spaces'),pin('dextract-sources'),pin('dextract-pages'),pin('dextract-layouts'),pin('dextract-ocr'),pin('dextract-tables'),pin('dextract-schemas'),pin('dextract-fields'),pin('dextract-checks'),pin('dextract-corrections')],systemDependencies:['documentExtractionSessions'],services:['dextractDatasets'],contributes:{http:dextractHttp('datasets'),routes:dextractRoutes('datasets')}});
