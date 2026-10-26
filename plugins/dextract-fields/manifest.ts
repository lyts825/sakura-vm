/** 字段提取的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {dextractRoutes,dextractHttp} from '../../shared/contracts/dextract-routes.generated.ts';
export const manifest=definePlugin({id:'dextract-fields',name:"字段提取",description:"字段候选、标准值、来源片段及歧义",category:'development',experimental:true,requires:[pin('dextract-spaces'),pin('dextract-pages'),pin('dextract-layouts'),pin('dextract-ocr'),pin('dextract-tables'),pin('dextract-schemas')],systemDependencies:['documentExtractionSessions'],services:['dextractFields'],contributes:{http:dextractHttp('fields'),routes:dextractRoutes('fields')}});
