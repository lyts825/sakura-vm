/** 地理数据工作室的完整成员集合。 */
import {definePack,member} from '../../shared/plugin-protocol.ts';
export const pack=definePack({id:'geospatial-studio',name:"地理数据工作室",description:"地理数据工作室：定义、处理、复核和交接。",members:[member('geodesk-spaces'),member('geodesk-sources'),member('geodesk-crs'),member('geodesk-validation'),member('geodesk-layers'),member('geodesk-operations'),member('geodesk-joins'),member('geodesk-indexes'),member('geodesk-runs'),member('geodesk-measures'),member('geodesk-styles'),member('geodesk-reviews'),member('geodesk-reports'),member('geodesk-exchange'),member('geodesk-workbench')]});
