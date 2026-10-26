/** 文档结构提取的完整成员集合。 */
import {definePack,member} from '../../shared/plugin-protocol.ts';
export const pack=definePack({id:'document-extraction-studio',name:"文档结构提取",description:"文档结构提取：定义、处理、复核和交接。",members:[member('dextract-spaces'),member('dextract-sources'),member('dextract-pages'),member('dextract-layouts'),member('dextract-ocr'),member('dextract-tables'),member('dextract-schemas'),member('dextract-fields'),member('dextract-checks'),member('dextract-corrections'),member('dextract-datasets'),member('dextract-reviews'),member('dextract-exchange'),member('dextract-workbench')]});
