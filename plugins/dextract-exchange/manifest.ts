/** 提取交接的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-exchange',name:"提取交接",description:"原件选择、结构数据与映射封套",category:'development',experimental:true,requires:[pin('dextract-spaces'),pin('dextract-sources'),pin('dextract-pages'),pin('dextract-layouts'),pin('dextract-ocr'),pin('dextract-tables'),pin('dextract-schemas'),pin('dextract-fields'),pin('dextract-checks'),pin('dextract-corrections'),pin('dextract-datasets'),pin('dextract-reviews')],services:['dextractExchange'],contributes:{http:dextractHttp('exchange'),routes:dextractRoutes('exchange')}});
