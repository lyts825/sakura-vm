/** 人工纠错的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-corrections',name:"人工纠错",description:"原值、修订值、原因、页内证据及编辑历史",category:'development',experimental:true,requires:[pin('dextract-spaces'),pin('dextract-pages'),pin('dextract-ocr'),pin('dextract-tables'),pin('dextract-fields'),pin('dextract-checks')],systemDependencies:['documentExtractionSessions'],services:['dextractCorrections'],contributes:{http:dextractHttp('corrections'),routes:dextractRoutes('corrections')}});
